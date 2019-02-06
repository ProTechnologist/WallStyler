var fs = require('fs');
var request = require("request");
var cheerio = require("cheerio");
var statusBar = require('status-bar'); // TODO: StatusBar implementation pending ...
var pathExists = require('path-exists');
var wallpaperMgr = require('wallpaper');
var ConfigStore = require('configstore');
var path = require('path');
var unrelative = require('unrelative');
var finder = require('fs-finder');
var later = require('later');

var configFile = './wallhaven.config.json';
var store = new ConfigStore('wallhaven');

// memory persistant config object.
// initial (functional) implementation was based on the file system which has been replaced by the configstore implementation. 
//global.config = null;

// variable to control the automatic wallpaper changer.
var timer = null;

var baseUrl = 'http://alpha.wallhaven.cc/';
var thumbnailUrTemplate = baseUrl + 'wallpapers/thumb/small/th-{id}.{ext}';
var wallpaperUrlTemplate = baseUrl + 'wallpaper/{id}';

// private function responsible for fetching IDs after parsing provided html.
function fetchIDs(url, fetchIDsCompleted) {
    request(url, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var $c = cheerio.load(body);
            var wallpaperThumbs = [];
            $c("figure[data-wallpaper-id]").each(function (i, element) {
                wallpaperThumbs.push({
                    id: $c(element).attr('data-wallpaper-id'),
                    ext: $c(element).find("img").attr("data-src").substr($c(this).length - 4),
                    res: $c(element).find(".wall-res").text(),
                    sfw: element.attribs['class'].indexOf('sfw') > 0,
                    sketchy: element.attribs['class'].indexOf('sketchy') > 0,
                    nsfw: element.attribs['class'].indexOf('nsfw') > 0
                });
            });

            //updating URLs for the thumbnails and wallpapers.
            for (var i in wallpaperThumbs) {
                wallpaperThumbs[i].thumbnailUrl = getThumbnailUrl(wallpaperThumbs[i].id, wallpaperThumbs[i].ext);
            }

            fetchIDsCompleted(wallpaperThumbs);
        }
        else {
            fetchIDsCompleted(null);
        }
    });
}

function getMaxPageNumber(url, callback) {
    try {
        request(url, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var $page = cheerio.load(body);

                var pageInfo = $page(".thumb-listing-page > header:nth-child(1)").text();

                if (pageInfo.indexOf('/') > 0) {
                    var maxPageNumber = pageInfo.split('/')[1].trim();
                    callback(parseInt(maxPageNumber));
                }
                else {
                    callback(1);
                }
            }
        });
    }
    catch (ex) {
        console.log(ex.message);
    }
}

// responsible for getting wallpaper thumbnail's URL.
function getThumbnailUrl(id, ext) {
    var url = thumbnailUrTemplate.replace('{id}', id).replace('{ext}', ext);
    return url;
}

// responsible for getting wallpaper URL,
function getWallpaperUrl(id, ext) {
    var url = wallpaperUrlTemplate.replace('{id}', id).replace('{ext}', ext);
    return url;
}

// Responsible for creating default config file and folder if file and/or folder doesn't already exists for wallpapers.
function initialize(callback) {
    if (store.size == 0) {
      
        // creating default settings object.
        var settings = new Object();
    
        //download path settings // shown in the first tab
        settings.downloadPath = null;
    
        //Automatic wallpaper changer scheduler settings
        settings.scheduler = new Object();
        settings.scheduler.enableWallpaperChanger = false;
        settings.scheduler.changeOnStartup = false;
    
        // automatic wallpaper changer - scheduler for wallpaper
        settings.scheduler.rules = [];
        settings.scheduler.scheduleTextExpression = '';
    
        // automatic wallpaper changer - selection for wallpapers that will be used to set as desktop wallpapers
        settings.filters = new Object();
        settings.filters.includeOfflineWallpapers = false;
        settings.filters.includeRandomWallpapers = false;
        settings.filters.includeLatestWallpapers = false;
        settings.filters.includeKeywords = false;
        settings.filters.keywords = null;
        settings.filters.MRW = true;
        
        // creating default placeholders for the resolution
        settings.resolution = new Object();
        settings.resolution.width = 0;
        settings.resolution.height = 0;

        store.set('settings', settings);
    }
    else {
        settings = store.get('settings');
    }

    if (settings.downloadPath != null) {
        pathExists(settings.downloadPath).then(function (exists) {
            if (!exists) {
                // wallpaper folder does not exists, lets create one,
                fs.mkdirSync(settings.downloadPath);
            }
        });

        settings.downloadPath = ToDisplayPath(settings.downloadPath);
    }

    if (settings.scheduler.changeOnStartup) {
        changeScheduledWallpaper();
    }

    enableScheduler();
    callback(settings);
}

// responsible for getting downloaded wallpapers (including first level folders/directories)
function getOfflineWallpapers(callback) {
    //var settings = ;
    var wp = store.get('settings').downloadPath; //store.get('wallpaperPath').toString();
    finder.in(wp).findFiles("*.<(jpg|jpeg|png|bmp|gif|tiff)>", function (foundFiles) {
        ToLocalURL(foundFiles, callback);
        // now search the files in all the folders.
        finder.in(wp).findDirectories(function (folders) {
            if (folders.length == 0) {
                return;
            }

            $(folders).each(function (i, folder) {
                finder.in(folder).findFiles(function (innerFiles) {
                    if (innerFiles.length != 0) {
                        $(innerFiles).each(function (i, foundFile2) {
                            //files.push(foundFile2);
                            ToLocalURL(foundFile2, callback); //callback(files);
                        });
                    }
                });
            });
        });
    });
}

// responsible for saving changes
function saveChanges(settings, callback) {
    settings.scheduler.scheduleTextExpression = getScheduleTextExpression(settings.scheduler.rules);
    store.set('settings', settings);

    updateSchedularStatus(settings.scheduler.enableWallpaperChanger);
    callback();
}

// responsible for getting displayable path of given path.
function ToDisplayPath(filePath) {
    if (typeof filePath !== 'string') {
        throw new Error('Expected a string');
    }

    return path.resolve(filePath);//.replace(/\\/g, '/');
}

// responsible for converting path of array of files to local system's path.
function ToLocalURL(files, callback) {

    if (files != null) {
        $(files).each(function (i, file) {
            file = encodeURI('file:/' + file);
        });
        callback(files);
    }
    else {
        callback([]); // returning empty array so that app won't crash because of null (error prevention module is pending).
    }
}

// responsible for getting wallpaper storage folder/directory path where wallpapers will be stored.
function getSettings(callback) {
    callback(store.get('settings'));
}

// responsible for getting wallpaper's absolute path.
function getLocalPath(wallpaper) {
    var localPath = store.get('settings').downloadPath + '\\' + wallpaper.id + "." + wallpaper.ext;
    return localPath;
}

// responsible for downloading wallpaper to defined folder/directory.
function downloadWallpaper(wallpaper, downloadCompletedCallback) {
    
    if(wallpaper == undefined || wallpaper == null) {
        downloadCompletedCallback(null);
    }
    
    //var localpath = getLocalPath(wallpaper);
    var url = wallpaperUrlTemplate.replace('{id}', wallpaper.id);
    request(url, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var $c = cheerio.load(body);
            $c("img[id='wallpaper']").each(function (index, element) {
                url = "http:" + $c(element).attr('data-cfsrc');
                var localPath = store.get('settings').downloadPath + '\\' + path.basename(url).replace('wallhaven-', '');
                request(url).pipe(fs.createWriteStream(localPath)).on('close', function () {
                    downloadCompletedCallback(localPath);
                });
            });
        }
    });
}

// public method responsible for managing interfaces and encapsulating the internal implementation details.
function load(url, loadCompletedCallback) {
    fetchIDs(url, loadCompletedCallback);
};

// responsible for updating system wallpaper.0
function validateAndSetWallpaper(wallpaper, callback) {
    // computing search pattern based on the input and the origin.
    var searchPattern = '';
    if (wallpaper.id == undefined) {
        searchPattern = path.basename(wallpaper.path);
    }
    else {
        searchPattern = wallpaper.id + '.*';
    }
  
    // checking if wallpaper is already available.
    finder.in(store.get('settings').downloadPath).findFiles(searchPattern, function (files) {
        // wallpaper doesn't already exists, let's download first and then set system wallpaper.
        if (files.length == 0) {
            downloadWallpaper(wallpaper, function (localPath) {
                setWallpaper(localPath, callback);
            });
        }
        else {
            // updating system's wallpaper as it already exist.
            setWallpaper(files[0].toString(), callback);
        }
    });
}

// responsible for updating system's wallpaper.
function setWallpaper(wallpaperPath, callback) {
    
    if(wallpaperPath == undefined || wallpaperPath == null || wallpaperPath == '') {
        callback(false);
    }
    
    // wallpaperMgr.set(path, function (err) {
    //     if (err) {
    //         callback(false);
    //     }
    //     else {
    //         callback(true);
    //     }
    // });
    
    // wallpaper api is no longer returning err even if file not found..
    wallpaperMgr.set(wallpaperPath, function() {
        // so returning true - always.
        callback(true);
    });
    
}

// responsible for deleting wallpaper from the file system.
function deleteWallpaper(filePath, callback) {
    fs.unlink(filePath, callback);
}

function updateResolutionInfo(width, height) {

    var settings = store.get('settings');

    settings.resolution.width = width;
    settings.resolution.height = height;

    store.set('settings', settings);
}

/***************** Automatic Wallapper Changer Scheduler (LaterJs) *****************/

// responsible for getting the text expression for the schedule
function getScheduleTextExpression(rules) {
    var textExpression = '';
    if (rules != null && rules.length != 0) {
        rules.forEach(function (rule) {
            if (textExpression.length > 0) textExpression = textExpression + ' also ';
            if (rule.type == 'every') {
                textExpression += 'every ' + rule.pulse + ' ' + rule.pulseType;
            }
            else if (rule.type == 'at') {
                textExpression += 'at ' + rule.time;
            }
        });
    }
    return textExpression;
}
 
// responsible for stopping the timer for scheduler
function disableSchedular() {
    if (timer != null) {
        timer.clear();
    }
}
 
// responsible for enabling timer for the automatic wallpaper changer 
function enableScheduler() {
    
    // just to make sure that the timer is properly clear (if case of any schedule existence)
    disableSchedular();
    
    var settings = store.get('settings');
    if (settings.scheduler.scheduleTextExpression.length != 0) {
        var scheduler = later.parse.text(settings.scheduler.scheduleTextExpression);
        later.date.localTime();
        timer = later.setInterval(changeScheduledWallpaper, scheduler);
    }
}
 
// update automatic wallpaper changer state, unable or disable based on end-user choice
function updateSchedularStatus(status) {
    if (status) {
        enableScheduler();
    }
    else {
        disableSchedular();
    }
}

function changeScheduledWallpaper() {
    var settings = store.get('settings');
    if (settings != null && settings.downloadPath != null && settings.scheduler.enableWallpaperChanger) {

        var filters = settings.filters;
        if (filters.includeOfflineWallpapers || filters.includeRandomWallpapers || filters.includeLatestWallpapers || filters.includeKeywords) {
            
            // finding random filter among offline, random and latest wallpapers as assigning numerical values to each filter
            var list = [];
            var wallpaperSourceType = 0;
            if (filters.includeOfflineWallpapers) list.push(1);
            if (filters.includeRandomWallpapers) list.push(2);
            if (filters.includeLatestWallpapers) list.push(3);
            if (filters.includeKeywords) list.push(4);
            
            // checking if list is empty, return ...
            if (list.length == 0) {
                return;
            }
            
            // checking if list has only 1 item, if so, no need find random.
            if (list.length == 1) {
                wallpaperSourceType = list[0];
            }
            else { // since there are at least 2 options to select from, let's find the random number from the array.
                wallpaperSourceType = getRandom(list);
            }

            if (wallpaperSourceType == 1) { // set random wallpaper from the collection of offline wallpapers
                getOfflineWallpapers(function (wallpapers) {
                    setWallpaper(getRandom(wallpapers), function (result) {
                        // notify
                    });
                });
            }
            if (wallpaperSourceType == 2) { // set random wallpaper from the collection of 'random' wallpapers
                applyOnlineWallpaper('random', function (result) {
                    // notify
                });
            }
            if (wallpaperSourceType == 3) { // set random wallpaper from the collection of 'latest' wallpapers
                applyOnlineWallpaper('latest', function (result) {
                    // notify
                });
            }

            if (wallpaperSourceType == 4) { // set random wallpaper from the collection of 'keyword search results' wallpapers
                applyKeywordWallpaper(function (result) {
                    // notify
                });
            }
        }
    }
}

function getRandom(obj) {
    // checking if object is array ... if so, return random objec from the array
    if (typeof (obj) == 'number') {
        var max = parseInt(obj), min = 1;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    if (typeof (obj) == 'object' && obj instanceof Array) {
        return obj[Math.floor(Math.random() * obj.length)]
    }

    throw new Error('unknonw type');
}

function applyOnlineWallpaper(type, callback) {
    // logic:   get random number between 1 to 10 then access that page and fetch all wallpaper IDs, once obtained, get random wallpaper ID
    //          and return
    
    var url = baseUrl + type + '?page=' + getRandom(15);
    fetchIDs(url, function (wallpapers) {
        downloadWallpaper(getRandom(wallpapers), function (path) {
            setWallpaper(path, callback);
        });
    });

    callback();
}

function applyKeywordWallpaper(processCompletedCallback) {

    var settings = store.get('settings');
    var array = settings.filters.keywords;

    if (array == null) {
        processCompletedCallback(false);
    }

    var keyword = null,
        list = null;

    list = array.split(',');

    if (list.length == 0) {
        processCompletedCallback(false);
    }
    if (list.length == 1) {
        keyword = list[0];
    }
    else {
        keyword = getRandom(list).trim();
    }
    
    // applying wallpaper.
    var url = baseUrl + "search?q=" + keyword;
    
    // filtering wallpapers based on the client resolution.
    if (settings.filters.MRW && settings.resolution.width != 0 && settings.resolution.height != 0) {
        url += '&resolutions=' + settings.resolution.width + 'x' + settings.resolution.height;
    }

    getMaxPageNumber(url, function (maxPageNumber) {
        // since now max page number is now available, re-compute the URL to get random wallpaper from the random page ...
        var randomPageNumber = getRandom(maxPageNumber);
        url = baseUrl + "search?q=" + keyword + "&page=" + randomPageNumber;
        if (settings.filters.MRW && settings.resolution.width != 0 && settings.resolution.height != 0) {
            url += '&resolutions=' + settings.resolution.width + 'x' + settings.resolution.height;
        }
        fetchIDs(url, function (list) {
            downloadWallpaper(getRandom(list), function (wallpaperPath) {
                setWallpaper(wallpaperPath, processCompletedCallback);
            });
        });
    });
}

module.exports.load = load;
module.exports.downloadWallpaper = downloadWallpaper;
module.exports.getOfflineWallpapers = getOfflineWallpapers;
module.exports.init = initialize;
module.exports.setWallpaper = validateAndSetWallpaper;
module.exports.saveChanges = saveChanges;
module.exports.getSettings = getSettings;
module.exports.deleteWallpaper = deleteWallpaper;
module.exports.updateResolutionInfo = updateResolutionInfo;


/*********** following code is not in use ****************/
// initial (functional) implementation was based on the file system which has been replaced by the configstore implementation.
// Responsible for creating default config file if file doesn't already exists.
// function checkConfig(callback) {
//   // checking if the config file exists. If not, create a default config file.
//   pathExists(configFile).then(function (exists) {
//     if (!exists) {
//       // config file doesn't exist.
//       // so create one
//       global.config = {
//         wallpaperPath: './/wallpapers'
//       };
//       // parsing data to writable string format
//       var data = JSON.stringify(global.config);
//       // writing data to file system
//       fs.writeFileSync(configFile, data);
//     }
//     else { // else case means config file exists, so lets read it...
//       // reading file and parse it into a JSON object
//       global.config = JSON.parse(fs.readFileSync(configFile).toString());
//     }
//   }).then(function () { // resolving second promise.
//     // checking if folder exists, if not, creating folder.
//     pathExists(global.config.wallpaperPath).then(function (exists) {
//       if (!exists) {
//         // wallpaper folder does not exists, lets create one
//         fs.mkdirSync(global.config.wallpaperPath);
//       }
//     });
//     // invoking a callback so that end-user can perform any desired option to update model/controller/UI/etc...
//     callback();
//   });
// }

// function loadConfig(callback) {
//   fs.readFile(configFile, function (err, data) {
//     global.config = JSON.parse(data.toString());
//     callback(global.config);
//   });
// }

// function saveConfig(settings, callback) {
//   var data = JSON.stringify(settings);
//   fs.writeFile('config.json', data, function (err) {
//     if (err)
//       callback(false)
//     else
//       callback(true);
//   });
// };
