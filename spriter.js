var http = require('http'),
	sys = require('sys'),
	childproc = require('child_process'),
    fs = require('fs'),
    path = require('path');

var cssContent = [];

var cssTemplate = '#mainClassName# #classModifier# {background: url("#imageUrl#") repeat scroll #x# #y# transparent}\n';

/**
 *
 * @param args (commandName, args, succes, error)
*/

function exec(args) {
    if (!args || !args.executable) {
        return;
    }

    var options = {
                    encoding: 'utf8',
                    timeout: 0,
                    maxBuffer: 500*1024,
                    killSignal: 'SIGKILL'
                  };

    var success = args.success;
    var error = args.error;

    if (typeof arguments[2] == 'object') {
        var keys = Object.keys(options);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (arguments[2][k] !== undefined) {
                options[k] = arguments[2][k];
            }
        }
    }
    
    var child = childproc.spawn(args.executable, args.args);
    var stdout = "";
    var stderr = "";
    var killed = false;
    var timedOut = false;

    var timeoutId;
    if (options.timeout > 0) {
        timeoutId = setTimeout(function () {
            if (!killed) {
                child.kill(options.killSignal);
                timedOut = true;
                killed = true;
                timeoutId = null;
            }
        }, options.timeout);
    }

    child.stdout.setEncoding(options.encoding);
    child.stderr.setEncoding(options.encoding);

    child.stdout.addListener("data", function (chunk) {
        stdout += chunk;
        if (!killed && stdout.length > options.maxBuffer) {
            child.kill(options.killSignal);
            killed = true;
        }
    });
    
    child.stderr.addListener("data", function (chunk) {
        stderr += chunk;
        if (!killed && stderr.length > options.maxBuffer) {
            child.kill(options.killSignal);
            killed = true;
        }
    });

    child.addListener("exit", function (code, signal) {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        if (code === 0 && signal === null) {
            if (success) {
                success(stdout, stderr);
            }
        }
        else {
            var e = new Error("Command " + (timedOut ? "timed out" : "failed") + ": " + stderr);
            e.timedOut = timedOut;
            e.killed = killed;
            e.code = code;
            e.signal = signal;
            if (error) {
                error(e, stdout, stderr);
            }
        }
    });

    return child;
};

function downloadFile(options){
    var inputFile = options.input;
    if (inputFile.indexOf('://') == -1){
        inputFile = 'file://' + inputFile;
    }

    var args = [inputFile];
    if (options.output){
        args.push('-o');
        args.push(options.output);
    }

    var command = {
        executable: 'curl',
        args: args,
        success: options.success,
        error: options.error
    };

    exec(command);
};

// remove all temporary files

function rmTemporaryFiles(filePrefix, callback, withProcessed){
    var deletedFiles = 0;
    var check = function(){
        if (++deletedFiles == (withProcessed ? 3 : 2) && callback){
            callback();
        }
    }

    fs.unlink(filePrefix, function(e){
        if (e) throw e;
        check();
    });

    fs.unlink(filePrefix + '.border.png', function(e){
        if (e) throw e;
        check();
    });

    if (withProcessed){
        fs.unlink(filePrefix + '.processed.png', function(e){
            if (e) throw e;
            check();
        });
    }
};

function successCrop(options){ // filePrefix, direction, height, width, inputFile, allDoneCallback
    //shortcuts
    var filePrefix = options.filePrefix;
    var direction = options.direction;
    var height = options.height;
    var width = options.width;
    var inputFile = options.inputFile;
    var allDoneCallback = options.allDoneCallback;

    path.exists(filePrefix + '.png', function(exists){
        if (direction){
            cssContent.push(height);
        }
        else{
            cssContent.push(width);
        }

        if (exists){
            // montage

            var args;

            if (direction){
                args = ['-geometry', '+0+0', '-tile', '1x', filePrefix + '.png', inputFile + '.processed.png', filePrefix + '.final.png'];
            }
            else{
                args = ['-geometry', '+0+0', filePrefix + '.png', inputFile + '.processed.png', filePrefix + '.final.png'];
            }

            exec({
                executable: 'montage',
                args: args,
                success: function(){
                    fs.rename(filePrefix + '.final.png', filePrefix + '.png', function(e){
                        if (e) {
                            sys.puts('Final rename error!');
                            throw e;
                        }

                        rmTemporaryFiles(inputFile, allDoneCallback, true);
                    });
                },
                error: function(e){
                    sys.puts('Montage error!');
                    throw e;
                }
            });
        }
        else{
            // rename inputFile + '.processed.png' -> filePrefix + '.png'
            fs.rename(inputFile + '.processed.png', filePrefix + '.png', function(e){
                if (e) {
                    sys.puts('First rename error!');
                    throw e;
                }

                rmTemporaryFiles(inputFile, allDoneCallback);
            });
        }
    });
};

function successBorder(options){ // width, space, height, inputFile, filePrefix, direction, allDoneCallback){
    //shortcuts
    var height = options.height;
    var width = options.width;
    var space = options.space;
    var inputFile = options.inputFile;
    var filePrefix = options.filePrefix;
    var direction = options.direction;
    var allDoneCallback = options.allDoneCallback;

    var newWidth = width + space;
    var newHeight = height;

    if (direction){
        newWidth = width;
        newHeight += space;
    }

    var args = [inputFile + '.border.png', '-crop', newWidth + 'x' + newHeight + '+' + space + '+' + space, inputFile + '.processed.png'];

    exec({
        executable: 'convert',
        args: args,
        success: function(){
            successCrop({
                filePrefix: filePrefix,
                direction: direction,
                height: height,
                width: width,
                inputFile: inputFile,
                allDoneCallback: allDoneCallback
            });
        },
        error: function(e){
            sys.puts('Crop error!');
            throw e;
        }
    });
};

function processImage(inputFile, filePrefix, space, direction, allDoneCallback){
    exec({
        executable: 'identify',
        args: ['-format', '%wx%h', inputFile],
        success: function(data){
            var splittedData = data.split('x');
            var width = splittedData[0] - 0;
            var height = splittedData[1] - 0;

            exec({
                executable: 'convert',
                args: [inputFile, '-frame', space + 'x' + space, inputFile + '.border.png'],
                success: function(){

                    successBorder({
                        width: width,
                        space: space,
                        height: height,
                        inputFile: inputFile,
                        filePrefix: filePrefix,
                        direction: direction,
                        allDoneCallback: allDoneCallback
                    });
                },
                error: function(e){
                    sys.puts('Adding border error!');
                    throw e;
                }
            });
        },
        error: function(e){
            sys.puts('Error identifying image!');
            throw e;
        }
    });
};

function main(settings){

    var options = {
        input: settings.url,
        output: settings.url + '.downloaded',
        success: function(){
                    processImage(settings.url + '.downloaded', settings.filePrefix, settings.space, settings.direction, settings.allDoneCallback);
                },
        error: function(e){
                  sys.puts('Uupsss... Error :(');
                  throw e;
                }
    };

    downloadFile(options);
};

function validateSettings(settings){

    if (!settings){
        return "No settings!";
    }

    if (!settings.name){
        return "No global name!";
    }

    if (!(settings.images && settings.images.length)){
        return "No images to process!";
    }

    for (var i = 0; i < settings.images.length; i++){
        var image = settings.images[i];
        if (!image.url){
            return "No url for one of the images!";
        }

        if (!image.name){
            return "No modificator name for one of the images!"
        }
    }

    return true;
}

/*
 * settings: name - output files name ([settings.name].png, [settings.name].css)
 *
 */

var fileArgIndex = process.argv.indexOf('-i');
if (fileArgIndex == -1 || (fileArgIndex + 1 >= process.argv.length)){
    sys.puts('usage: node spriter.js -i url');
}
else{
    var val = process.argv[fileArgIndex + 1];

    var options = {
        input: val,
        success: function(out){
            var settings;
            try{
                settings = eval('settings = ' + out);
            }
            catch(e){
                sys.puts('Hmmm... Looks like invalid settings.');
                process.exit();
            }

            var isValid = validateSettings(settings);
            if (isValid !== true){
                sys.puts('Settings is not valid!');
                sys.puts(isValid);
                process.exit();
            }

            var images = settings.images;

            var imageIndex = 0;
            var space = settings.space - 0;

            if (!space){
                space = 0;
            }

            var direction = settings.direction == 'vertical';

            var allDoneCallback = function(){
                if (imageIndex < images.length){
                    var currentImage = images[imageIndex++];
                    var settingsForIteration = {
                        url: currentImage.url,
                        imageName: currentImage.name,
                        filePrefix: settings.name,
                        space: (imageIndex == images.length ? 0 : space),
                        direction: direction,
                        allDoneCallback: arguments.callee
                    }

                    main(settingsForIteration);
                }
                else{
                    var cssString = "";
                    for (var i = 0; i < cssContent.length; i++){
                        var size = cssContent[i];
                        var offset = (size + space) * i;
                        var x = direction? 0 : (offset? offset + 'px': 0);
                        var y = x? 0 : (offset? offset + 'px': 0);

                        cssString += cssTemplate
                                .replace(/#mainClassName#/g, '.' + settings.name)
                                .replace(/#classModifier#/g, '.' + images[i].name)
                                .replace(/#imageUrl#/g, settings.name + '.png')
                                .replace(/#x#/g, x)
                                .replace(/#y#/, y);
                    }

                    fs.writeFile(settings.name + '.css', cssString, function(e){
                        if (e){
                            sys.puts('Writing to css failed!');
                            throw e;
                        }
                    });
                }
            }

            allDoneCallback();
        },
        error: function(e){
            sys.puts('Uupsss... Error. Cannot download settings file.');
            throw e;
        }
    };

    downloadFile(options);
};