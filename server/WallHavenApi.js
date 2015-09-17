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

var configFile = './wallhaven.config.json';
var store = new ConfigStore('wallhaven');

// memory persistant config object.
// initial (functional) implementation was based on the file system which has been replaced by the configstore implementation. 
//global.config = null;

var thumbnailUrTemplate = "http://alpha.wallhaven.cc/wallpapers/thumb/small/th-{id}.{ext}";
var wallpaperUrlTemplate = "http://alpha.wallhaven.cc/wallpaper/{id}";

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
        //wallpaperThumbs[i].wallpaperUrl = getWallpaperUrl(wallpaperThumbs[i].id, wallpaperThumbs[i].ext);
      }

      fetchIDsCompleted(wallpaperThumbs);
    }
    else {
      fetchIDsCompleted(null);
    }
  });
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
function checkConfig(callback) {
  if (store.size == 0 || store.get('wallpaperPath') == null) {
    store.all = {
      wallpaperPath: './/wallpapers'
    }
  }

  pathExists(store.get('wallpaperPath').toString()).then(function (exists) {
    if (!exists) {
      // wallpaper folder does not exists, lets create one,
      fs.mkdirSync(store.get('wallpaperPath'));
    }
  });

  callback(ToDisplayPath(store.get('wallpaperPath').toString()));
}

// responsible for getting downloaded wallpapers (including first level folders/directories)
function getDownloadedWallpapers(callback) {
  var wp = store.get('wallpaperPath').toString();
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

// responsible for updating folder/directory path where wallpapers will be stored.
function updateWallpaperPath(newPath, callback) {
  store.set('wallpaperPath', newPath);
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
function getWallpaperPath(callback) {
  callback(store.get('wallpaperPath'));
}

// responsible for getting wallpaper's absolute path.
function getLocalPath(wallpaper) {
  var localPath = store.get('wallpaperPath') + '\\' + wallpaper.id + "." + wallpaper.ext;
  return localPath;
}

// responsible for downloading wallpaper to defined folder/directory.
function downloadWallpaper(wallpaper, downloadCompletedCallback) {
  //var localpath = getLocalPath(wallpaper);
  var url = wallpaperUrlTemplate.replace('{id}', wallpaper.id);
  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var $c = cheerio.load(body);
      $c("img[id='wallpaper']").each(function (index, element) {
        url = "http:" + $c(element).attr('src');
        var localPath = store.get('wallpaperPath') + '\\' + path.basename(url).replace('wallhaven-', '');
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
  if(wallpaper.id == undefined) {
    searchPattern = path.basename(wallpaper.path);
  }
  else {
    searchPattern = wallpaper.id + '.*';
  }
  
  // checking if wallpaper is already available.
  finder.in(store.get('wallpaperPath').toString()).findFiles(searchPattern, function (files) {
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
function setWallpaper(path, callback) {
  wallpaperMgr.set(path, function (err) {
    if (err) {
      callback(false);
    }
    else {
      callback(true);
    }
  });
}

// responsible for deleting wallpaper from the file system.
function deleteWallpaper(filePath, callback) {
  fs.unlink(filePath, callback);
}

module.exports.load = load;
module.exports.downloadWallpaper = downloadWallpaper;
module.exports.getDownloadedWallpapers = getDownloadedWallpapers;
module.exports.init = checkConfig;
module.exports.setWallpaper = validateAndSetWallpaper;
module.exports.updateWallpaperPath = updateWallpaperPath;
module.exports.getWallpaperPath = getWallpaperPath;
module.exports.deleteWallpaper = deleteWallpaper;


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
