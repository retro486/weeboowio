// Code goes here

var app = angular.module('WioApp', [])
  .config(function($httpProvider) {
    $httpProvider.defaults.useXDomain = true;
  })
  .directive('wio', function() {
    return {
      restrict: 'A',
      controller: function($scope, $http, $q, $filter, $interval) {
        $scope.server = 'http://wio.rdkl.us';
        $scope.user = {};
        $scope.userAccessToken = localStorage.getItem('userAccessToken');
        $scope.otaStatus = {};

        var uri = function(path, token) {
          return($scope.server + path + '?access_token=' + token);
        };

        var preloadData = function() {
          console.debug('Using token ' + $scope.userAccessToken);
          var waits = [];

          waits.push($http.get(uri('/v1/scan/drivers', $scope.userAccessToken)).then(function(response) {
            // InterfaceType (type used to match ports on board), SKU (used for tracking), GroveName (english readable name), ImageURL (VERY helpful image preview of module - TODO download all these for local hosting...)
            $scope.drivers = response.data.drivers;
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
              var node = this;
              $http.get(uri('/v1/node/config', node.node_key)).then(function(response) {
                node.config = response.data; // will only contain an error field if config doesn't yet exist
              }, function(response) {
                console.debug('Unable to get node config:', response);
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
                  $scope.nodes[i].boardObj.interfaces[this].availableDrivers = $filter('filter')($scope.drivers, {InterfaceType: type}).sort();
                });
              }
            });
          });
        };

        if($scope.userAccessToken) {
          preloadData();
        }

        $scope.logIn = function() {
          $http.post($scope.server + '/v1/user/login?password=' + $scope.user.password +
            '&email=' + $scope.user.email)
            .then(function(response) {
              $scope.user = {};
              $scope.userAccessToken = response.data.token;
              localStorage.setItem('userAccessToken', $scope.userAccessToken);
              preloadData();
            }, function(response) {
              console.debug(response);
              alert('Unable to log in.');
            });
        };

        $scope.logOut = function() {
          $scope.userAccessToken = undefined;
          localStorage.removeItem('userAccessToken');
        };

        $scope.save = function(node) {
          var data = {board_name: node. board, connections: [], access_token: node.node_key};

          $.each(node.boardObj.interfaceFields, function(i) {
            var field = node.boardObj.interfaceFields[i];
            var driver = node.boardObj.interfaces[field].selectedDriver;
            var conn = {port: field};

            if(driver !== undefined) conn.sku = driver.SKU;
            else conn.sku = '';

            data.connections.push(conn);
          });

          $http.post($scope.server + '/v1/ota/trigger', data).then(function(response) {
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
            alert('Unable to save your changes.');
          });
        };
      }
    };
  });
