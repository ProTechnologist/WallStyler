/* global wallhavenApp */
var api = require('./server/WallHavenApi')
//var remote = require('remote');
var ipc = require('ipc');

var appCtrl = WallStyler.controller('appCtrl', ['$scope', 'toastr', '$window', function ($scope, toastr, $window) {

	// private variables
	var currentPageIndex = 1;
	var baseUrl = 'http://alpha.wallhaven.cc/';
	var url = '';

	// public variables
	$scope.query = '';
	$scope.viewMode = 'online';
	$scope.IsSFW = true;
	$scope.IsSketchy = false;
	$scope.IsMRW = false;
	$scope.status = '';
	$scope.wallpapers = [];
	$scope.localWallpapers = [];
	$scope.localFolderPath = '';
	$scope.IsBusy = null;
    $scope.settings = null;

	/********** private functions **********/
	function init() {
		api.init(function (settings) {
			//$scope.localFolderPath = path.toString();
            $scope.settings = settings;
		});
	}

	init();
	
	// responsible for setting up wallpaper with notifications including UI and flag updates.
	function setWallpaper(wallpaper) {
		api.setWallpaper(wallpaper, function (result) {
			if (result) {
				wallpaper.status = 'local';
				toastr.success('Wallpaper updated successfully.');
			}
			else {
				toastr.error('Wallpaper could not set. Please report to GitHub Repo');
			}
		});
	}
	
	// responsible for building up the URL in order to get new wallpapers.
	function getUrl() {
		url = baseUrl + 'search?';
		var purity = '{sfw}{sketchy}{nsfw}';

		if ($scope.query != '') {
			url += 'q=' + $scope.query;
		}

		// computing SFW (SafeForWork) wallpaper filter
		purity = purity.replace('{sfw}', ($scope.IsSFW ? '1' : '0'));
		// computing Sketchy wallpaper filter
		purity = purity.replace('{sketchy}', ($scope.IsSketchy ? '1' : '0'));
		// computing Sketchy wallpaper filter
		purity = purity.replace('{nsfw}', '0');

		url += '&purity=' + purity;

		// computing MRW (MyResolutionWallpapers) wallpaper filter
		if ($scope.IsMRW) {
			url += '&resolutions=' + $window.screen.width + 'x' + $window.screen.height;
		}
		
		// computing next page number for the URL to fetch next batch of wallpapers
		if (currentPageIndex > 1) {
			url += '&page=' + currentPageIndex.toString();
			toastr.success('loading page # ' + currentPageIndex);
		}

		return url;
	}
	
	// responsible for updating the wallpaper collection into the view
	// TODO: check file system if wallpaper is already available. If so, update available options (i.e. set wallpapers)
	// Note: However, if wallpaper is already available, it won't download again.
	function render(list) {
		angular.forEach(list, function (wallpaper, index) {
			// updating wallpaper object status that this wallpaper is live and no yet available
			wallpaper.status = 'live';
			// updating live wallpaper collection so that it start appearing on the UI.
			$scope.wallpapers.push(wallpaper);
		});
		// updating scope
		// TODO: check why scope update is required at this point.
		$scope.$apply();
	};
	
	function resetScope() {
		$scope.viewMode = "online";
		$scope.wallpapers = [];
		currentPageIndex = 1;
	}
	
	/********** public functions **********/

	$scope.showFolderDialog = function () {
		ipc.send('show-folder-dialog');
		ipc.on('folder-selected', function (path) {
			$scope.localFolderPath = path.toString();
			$scope.$apply();
		});
	}

	$scope.saveChanges = function () {
		api.saveChanges($scope.settings, function () {
			$scope.showOfflineWallpapers();
			toastr.success('Settings have been applied successfully.');
		});
	}

	$scope.cancelChanges = function () {
		api.getSettings(function (settings) {
			$scope.settings = settings;
			toastr.info('Changes in settings discarded succesfully.');
		});
	}

	// responsible for setting wallpaper by sending call to api with the wallppaper information.
	$scope.setWallpaper = function (wallpaper) {
		if (wallpaper.status != 'local') {
			//$scope.downloadWallpaper(wallpaper, setWallpaper(wallpaper));
			wallpaper.status = 'downloading';
		}
		setWallpaper(wallpaper);
	}

	// responsible for updating SFW filter.
	$scope.updateSFW = function () {
		$scope.IsSFW = !$scope.IsSFW;
	};

	// responsible for updating Sketchy filter.
	$scope.updateSketchy = function () {
		$scope.IsSketchy = !$scope.IsSketchy;
	};

	// responsible for updating MRW filter.
	$scope.updateMRW = function () {
		$scope.IsMRW = !$scope.IsMRW;
	};

	$scope.refresh = function () {
		resetScope();
		
		$scope.load(getUrl());
	};

	// responsible for getting wallpapers based on the search query and user defined filters.
	$scope.search = function () {
		console.log('search button fired');
		resetScope();
		$scope.load(getUrl());
	};

	// responsible for engaging latest wallpaper mode so application accts accordingly.
	$scope.latest = function () {
		resetScope();
		
		$scope.query = '';
		$scope.IsMRW = false;
		url = baseUrl + "latest";
		
		$scope.load(url);
	};

	// responsible for engaging random wallpaper mode so application accts accordingly.
	$scope.random = function () {
		resetScope();
		
		$scope.query = '';
		$scope.IsMRW = false;
		
		url = baseUrl + 'random';
		$scope.load(url);
	};

	// responsible for fetching/loading wallpapers from the source (i.e. wallhaven).
	$scope.load = function (url) {
		$scope.status = 'Busy';
		api.load(url, function (list) {
			render(list);
			$scope.status = 'Idle';
		});
	};

	// responsible for loading more wallpapers as soon as user reaches to bottom of the wallpaper collection.
	// TODO: before fetching more wallpapers, check if more wallpapers exists.
	$scope.loadMore = function () {
		//checking if user is in online mode. If not, lets not do anything.
		if ($scope.viewMode != 'online') return;
		
		//before sending request to fetch more wallpapers, updating page number so that next batch of wallpapers can be downloaded.
		currentPageIndex++;
		// constructing URL and sending request for getting more wallpapers.
		$scope.load(getUrl());
	};

	// responsible for downloading wallpaper from the source.
	$scope.downloadWallpaper = function (wallpaper, callback) {
		// updating wallpaper status to downloading so that UI will be updated accordingly.
		wallpaper.status = 'downloading';
		// sending call to API to begin downloading wallpaper.
		api.downloadWallpaper(wallpaper, function () {
			wallpaper.status = 'local';
			$scope.$apply();
			// letting user know that the wallpaper has been downloaded.
			toastr.info('Wallpaper successfully downloaded.');

			if (callback != null) callback();
		});
	}

	// responsible for fetching user wallpapers from the file system.
	$scope.showOfflineWallpapers = function () {
		$scope.viewMode = 'offline';
		$scope.localWallpapers = [];
		api.getOfflineWallpapers(function (files) {
			if (typeof files == 'string') { // adding single wallpaper found to scope's localWallpaper collection.
				$scope.localWallpapers.push({
					path: files
				});
			}
			else { // adding the collection of wallpapers to the scope's localWallpapers so that user can see wallpapers.
				$(files).each(function (i, file) {
					$scope.localWallpapers.push({
						path: file
					});
				});
			}
			// updating scope in order to sync changes with the UI.
			$scope.$apply();
			// updating client side gallery
			$window.enableGallery();
		});
	}

	// responsible for deleting wallpaper from the file system after user's confirmation.
	$scope.deleteWallpaper = function (wallpaper) {
		if ($window.confirm('Are you sure you want to delete this wallpaper?')) {
			api.deleteWallpaper(wallpaper.path, function (err) {
				if (!err) {
					// removing wallpaper from the user's viewable wallpaper collection.
					$scope.localWallpapers.splice($scope.localWallpapers.indexOf(wallpaper), 1);
					// notifying user about the successfull deletion status
					toastr.success('Wallpaper deleted successfully.');
				}
				else {
					// notifying user about the erroneous deletion status.
					toastr.error('Error deleting file. Please contact me on GitHub!');
				}
			});
		}
	}
    
    $scope.addNewScheduleRule = function() {
        if($scope.settings.scheduler.rules == null){
            $scope.settings.scheduler.rules = [];
        }
        $scope.settings.scheduler.rules.push({
            type: 'every',
            pulse: 1,
            pulseType: 'hours'
        });
        
        // following function is a work-around to enable time-picker on the schedular
        // when dynamic entries are added to the as well as the the $scope.
        // a better solution search is pending after the feature is completed.
        setTimeout(function() {
            $('.timepicker').timepicker();
        }, 1);
    }
    
    $scope.removeScheduleRule = function(rule) {
        $scope.settings.scheduler.rules.splice($scope.settings.scheduler.rules.indexOf(rule), 1);
    }
    
}]);
