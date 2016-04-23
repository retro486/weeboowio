var app = angular.module('WioApp', [])
  .config(function($httpProvider) {
    $httpProvider.defaults.useXDomain = true;
  })
  .directive('wio', function() {
    return {
      restrict: 'A',
      controller: function($scope, $http, $q, $filter, $interval) {
        $scope.user = {};
        $scope.otaStatus = {};

        $scope.server = localStorage.getItem('server');
        $scope.userAccessToken = localStorage.getItem('userAccessToken');

        var uri = function(path, token) {
          return($scope.server + path + '?access_token=' + token);
        };

        var preloadData = function() {
          var waits = [];

          waits.push($http.get(uri('/v1/scan/drivers', $scope.userAccessToken)).then(function(response) {
            // InterfaceType (type used to match ports on board), SKU (used for tracking), GroveName (english readable name), ImageURL (VERY helpful image preview of module - TODO download all these for local hosting...)
            $scope.driverMap= {};
            $scope.drivers = [];

            // Map api keys to something easier to digest for various things.
            $.each(response.data.drivers, function(i) {
              $scope.driverMap[this.SKU] = {type: this.InterfaceType, name: this.GroveName, image: this.ImageURL, sku: this.SKU};
              $scope.drivers.push({type: this.InterfaceType, name: this.GroveName, image: this.ImageURL, sku: this.SKU});
            });

            return response;
          }, function(response) {
            console.debug(response);
            alert('Unable to load available drivers.');
            return response;
          }));

          waits.push($http.get(uri('/v1/boards/list', $scope.userAccessToken)).then(function(response) {
            // board.interfaces (.type), .board_name (string name of board model)
            $scope.boards = response.data.boards;
            return response;
          }, function(response) {
            console.debug(response);
            alert('Unable to load available boards.');
            return response;
          }));

          waits.push($http.get(uri('/v1/nodes/list', $scope.userAccessToken)).then(function(response) {
            // node.name, online, node_key (used for node actions like config), node_sn, board (string name of board model)
            $scope.nodes = response.data.nodes;

            $.each($scope.nodes, function(i) {
              $scope.nodes[i].config = {};

              $http.get(uri('/v1/node/config', $scope.nodes[i].node_key)).then(function(resp) {
                if(resp.data.config.connections) {
                  $.each(resp.data.config.connections, function() {
                    $scope.nodes[i].config[this.port] = $scope.driverMap[this.sku];
                  });
                }
              }, function(resp) {
                console.debug('Unable to get node config:', resp);
              })
            });
            return response;
          }, function(response) {
            console.debug(response);
            alert('Unable to load available nodes.');
            return response;
          }));

          $q.all(waits).then(function() {
            // Do something once all the data is loaded...
            $.each($scope.nodes, function(i) {
              var board = this.board;
              $scope.nodes[i].boardObj = $filter('filter')($scope.boards, {board_name: board})[0];
              if($scope.nodes[i].boardObj !== undefined) {
                $scope.nodes[i].boardObj.interfaceFields = Object.keys($scope.nodes[i].boardObj.interfaces).sort();

                // Map interfaces with their available driver types
                $.each($scope.nodes[i].boardObj.interfaceFields, function(j) {
                  var type = $scope.nodes[i].boardObj.interfaces[this].type;
                  $scope.nodes[i].boardObj.interfaces[this].availableDrivers = $filter('filter')($scope.drivers, {type: type});
                });
              }
            });
          });
        };

        $scope.logIn = function() {
          $http.post($scope.server + '/v1/user/login', {password: $scope.user.password, email: $scope.user.email})
            .then(function(response) {
              $scope.user = {};
              $scope.userAccessToken = response.data.token;
              localStorage.setItem('userAccessToken', $scope.userAccessToken);
              localStorage.setItem('server', $scope.server);
              preloadData();
            }, function(response) {
              console.debug(response);
              alert('Unable to log in.');
            });
        };

        $scope.logOut = function() {
          $scope.userAccessToken = undefined;
          localStorage.removeItem('userAccessToken');
          localStorage.removeItem('server');
        };

        $scope.save = function(node) {
          var data = {board_name: node.board, connections: []};
          $scope.otaStatus[node.node_key] = {ota_status: 'going', ota_msg: 'Sending config...'};

          $.each(Object.keys(node.config), function(i) {
            if(node.config[this] === null) return; // Set a value, saved, then cleared it.

            var port = this;
            var sku = node.config[port].sku;

            data.connections.push({port: port, sku: sku});
          });

          $http.post($scope.server + '/v1/ota/trigger?access_token=' + node.node_key, data).then(function(response) {
            $scope.otaStatus[node.node_key] = response.data;

            if(response.data.ota_status !== 'error') {
              $scope.otaStatus[node.node_key].timer = $interval(function() {
                $http.get(uri('/v1/ota/status', node.node_key)).then(function(response) {
                  $.extend($scope.otaStatus[node.node_key], response.data);
                  if(response.data.ota_status !== 'going') {
                    $interval.cancel($scope.otaStatus[node.node_key].timer);
                  }
                  return response;
                }, function(response) {
                  console.debug(response);
                  $interval.cancel($scope.otaStatus[node.node_key].timer);
                  $.extend($scope.otaStatus[node.node_key], {ota_status: 'error', ota_msg: 'Unable to save your changes.'});
                  return response;
                });
              }, 2000);
            }
          }, function(response) {
            console.debug(response);
            $scope.otaStatus[node.node_key]['ota_status'] = 'error';
            $scope.otaStatus[node.node_key]['ota_msg'] = response.data;
          });
        };

        if($scope.userAccessToken && !$scope.server) {
          $scope.logOut();
        } else if($scope.userAccessToken) {
          preloadData();
        }
      }
    };
  });
