(function() {
    var token = 'YOUR_TOKEN_HERE', // Token received from BotFather
        apiUrl = 'https://api.telegram.org/bot'+token,
        updateId = localStorage.getItem('offset') || 0,
        chatSettings = localStorage.getItem('chatSettings') || '{}',
        inProgress = false,
        taskManager = new TaskManager(),
	    helpResponse = [
            '发送位置信息到当前机器人, 然后选择是否纠偏及地图缩放等级(3 - 17). Happy Ingressing!',
            '图片压缩启用及关闭请使用 /compression_on 和 /compression_off',
            'Authors: @veikus and @fivepointseven, Modified @kaoyu',
            'Source code: https://github.com/kaoyusu/ingresshelper'
        ],
	    // Custom keyboard markup:
	    rectifyMarkup = {
            keyboard: [
                ['true'],
                ['17 - All portals'],
                ['16', '15', '14', '13'],
                ['12', '10', '8', '6'],
                ['3 - World']
            ],
            one_time_keyboard: true
        },
	    // Custom keyboard markup:
	    levelMarkup = {
            keyboard: [
                ['17 - All portals'],
                ['16', '15', '14', '13'],
                ['12', '10', '8', '6'],
                ['3 - World']
            ],
            one_time_keyboard: true
        },
        allowedLevelOptions = [
            '17 - All portals', '17', '16', '15', '14', '13', '12', '11', '10',
            '9', '8', '7', '6', '5', '4', '3', '3 - World'
        ];

    chatSettings = JSON.parse(chatSettings);
    getUpdates();

    chrome.runtime.onMessage.addListener(function(request, sender) {
        makeScreenshot();
    });

    function getRequest(url, callback) {
        var xmlhttp = new XMLHttpRequest();

        if (typeof callback !== 'function') {
            callback = undefined;
        }

        xmlhttp.onreadystatechange = function() {
            var result = null;

            if (xmlhttp.readyState !== 4) {
                return;
            }

            if (xmlhttp.status == 200) {
                try {
                    result = JSON.parse(xmlhttp.responseText);
                } catch (e) {
                    console.error('JSON parse error: ' + e);
                }
            } else {
                console.error('GET Request incorrect status: ' + xmlhttp.status + ' ' + xmlhttp.statusText);
            }

            if (callback) {
                callback(result);
            }
        };

        xmlhttp.open('GET', url, true);
        xmlhttp.send();
    }

    /**
     * Receive new messages and process them
     */
    function getUpdates() {
        var url = apiUrl + '/getUpdates?timeout=7';

        if (updateId) {
            url += '&offset='+updateId;
        }

        getRequest(url, function(data) {
            if (data && data.ok) {
                data.result.forEach(function(task) {
                    updateId = task.update_id + 1;
                    localStorage.setItem('offset', updateId);
                    processTask(task);
                });
            }

            getUpdates();
        })
    }

    /**
     * Process single message
     * @param task
     */
    function processTask(task) {
        var z, i,
            chatId = task.message.chat.id,
            isGroup = chatId < 0;

        if (task.message.location) {
            // Ask for zoom and cache location request
            sendResponse(task, '由于Telegram内地图偏移,需纠偏请选true,否则直接选择缩放等级', rectifyMarkup);
            taskManager.addTask(task);
        } else {
            switch (task.message.text) {
                case '/start':
                case '/help':
                    for  (i = 0; i < helpResponse.length; ++i) {
                        (function(i) { // TODO: find another way to send multiline messages
                            setTimeout(function() {
                                sendResponse(task, helpResponse[i]);
                            }, i * 500);
                        }(i));
                    }
                    break;

                case '/compression_on':
                    if (!chatSettings[chatId]) {
                        chatSettings[chatId] = {};
                    }
                    chatSettings[chatId].noCompression = false;
                    localStorage.setItem('chatSettings', JSON.stringify(chatSettings));

                    sendResponse(task, '图片压缩已启用');
                    break;

                case '/compression_off':
                    if (!chatSettings[chatId]) {
                        chatSettings[chatId] = {};
                    }
                    chatSettings[chatId].noCompression = true;
                    localStorage.setItem('chatSettings', JSON.stringify(chatSettings));

                    sendResponse(task, '图片压缩已取消');
                    break;

                case 'true':
                    if(taskManager.setRectify(task)){
                        sendResponse(task, '选择缩放等级', levelMarkup);
                    }else{
                        sendResponse(task, '请先发送位置信息');
                    }
                    break;

                default:
                    if (allowedLevelOptions.indexOf(task.message.text) > -1) {
                        z = parseInt(task.message.text);
                    } else if (!isGroup) {
                        sendResponse(task, '错误命令.');
                    }
            }

            if (z) {
                if (taskManager.setZoom(task, z)) {
                    sendResponse(task, '任务已建立. 请等待大约 ' + taskManager.calculateEstimateTime());

                    if (!inProgress) {
                        startNextTask();
                    }
                } else {
                    sendResponse(task, '请先发送位置信息');
                }
            }

        }
    }

    /**
     * Send specified text for selected task
     * @param task
     * @param text
     * @param markup
     */
    function sendResponse(task, text, markup) {
        if (!markup) {
            markup = { hide_keyboard: true };
        }

        markup = JSON.stringify(markup);

        var url = apiUrl + '/sendMessage?chat_id='+task.message.chat.id+'&text='+text+'&disable_web_page_preview=true&reply_markup='+markup;

        getRequest(url);
    }

    /**
     * Send photo for selected task
     * @param task
     * @param img
     */
    function sendPhoto(task, img) {
        var xhr = new XMLHttpRequest(),
            formData = new FormData(),
            chatId = task.message.chat.id,
            noCompression = chatSettings[chatId] && chatSettings[chatId].noCompression,
            url = apiUrl + (noCompression ? '/sendDocument' : '/sendPhoto');

        formData.append('chat_id', chatId);
        formData.append(noCompression ? 'document' : 'photo', dataURItoBlob(img), 'screen.png');

        xhr.open('POST', url, true);
        xhr.send(formData);
    }

    /**
     * Creates intel tab
     */
    function startNextTask() {
	    var latitude, longitude, timeout,
            task = taskManager.getTask();

        if (!task) {
            return;
        }

        inProgress = task;
        latitude = task.message.location.latitude;
        longitude = task.message.location.longitude;

        if(task.rectify){
	    var ret = gcj2wgs(latitude, longitude);
	    latitude = ret.lat.toFixed(6).toString();
	    longitude = ret.lng.toFixed(6).toString();
        }

	    // Set higher timeout for L7+ portals
	    if (task.zoom <= 7) {
		    timeout = 120000;
	    } else {
            timeout = 60000;
        }

        chrome.windows.create({ url: 'https://www.ingress.com/intel?ll=' + latitude + ',' + longitude + '&z=' + task.zoom, type: "popup"}, function(window) {
            task.window = window;
            task.timeout = setTimeout(makeScreenshot, timeout);
        });
    }

    /**
     * Makes screenshot and finishes task
     */
    function makeScreenshot() {
        var window,
            task = inProgress;

        // If timeout and message both triggered
        if (!task) {
            return;
        }

        inProgress = false;
        window = task.window;

        clearTimeout(task.timeout);

        chrome.tabs.captureVisibleTab(window.id, { format: 'png' }, function(img) {
            if (!img) {
                sendResponse(task, 'I`m sorry. Looks like something comes really wrong. Please try again in few minutes');
            } else {
                sendPhoto(task, img);
            }

            chrome.windows.remove(window.id);
            startNextTask();
        });
    }

    /**
     * Convert base64 to raw binary data held in a string
     */
    function dataURItoBlob(dataURI) {
        var mimeString, ab, ia, i,
            byteString = atob(dataURI.split(',')[1]);

        // separate out the mime component
        mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

        // write the bytes of the string to an ArrayBuffer
        ab = new ArrayBuffer(byteString.length);
        ia = new Uint8Array(ab);
        for (i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }

        return new Blob([ab], {type: mimeString});
    }


    /**
     * Screenshot task manager
     * @constructor
     */
    function TaskManager() {
        var incompleteQueue = {},
            queue = [],
            activeTask = null;

        /**
         * Creates task
         * @param task {object} Telegram object from getUpdates
         */
        this.addTask = function(task) {
            var from = task.message.from.id;

            task.from = from;
            incompleteQueue[from] = task;
        };

        this.setRectify = function(task) {
            var from = task.message.from.id;

            if (!incompleteQueue[from]) {
                return false;
            }

            incompleteQueue[from].rectify = true;

            return true;
        };

        /**
         * Set zoom level for users incomplete task
         * @param task {object} Telegram object from getUpdates
         * @param zoom {number} Zoom level
         * @returns {boolean} Is task found and updated
         */
        this.setZoom = function(task, zoom) {
            var from = task.message.from.id;

            if (!incompleteQueue[from]) {
                return false;
            }

            incompleteQueue[from].zoom = zoom;
            queue.push(incompleteQueue[from]);
            delete incompleteQueue[from];

            return true;
        };

        /**
         * Calculates estimate time
         * @param key {number|undefined} key (or latest created will be used)
         * @returns {string}
         */
        this.calculateEstimateTime = function(key) {
            var i, left,
                est = 0;

            key = key ? key + 1 : queue.length;

            for (i = 0; i <= key; ++i) {
                if (queue[i]) {
                    est += queue[i].zoom <= 7 ? 120 : 60;
                }
            }

            if (est < 60) {
                return est + ' 秒';
            } else {
                left = Math.ceil(est / 60);
                return left + ' 分钟';
            }
        };

        /**
         * Return latest created task
         * @returns {object} Telegram object from getUpdates (with some additional properties)
         */
        this.getTask = function() {
            return queue.shift();
        }
    }

//https://github.com/googollee/eviltransform/blob/master/javascript/transform.js

function outOfChina(lat, lng) {
	if ((lng < 72.004) || (lng > 137.8347)) {
		return true;
	}
	if ((lat < 0.8293) || (lat > 55.8271)) {
		return true;
	}
	return false;
}

function transformLat(x, y) {
	var ret = -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
	ret += (20.0*Math.sin(6.0*x*Math.PI) + 20.0*Math.sin(2.0*x*Math.PI)) * 2.0 / 3.0;
	ret += (20.0*Math.sin(y*Math.PI) + 40.0*Math.sin(y/3.0*Math.PI)) * 2.0 / 3.0;
	ret += (160.0*Math.sin(y/12.0*Math.PI) + 320*Math.sin(y*Math.PI/30.0)) * 2.0 / 3.0;
	return ret;
}

function transformLon(x, y) {
	var ret = 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
	ret += (20.0*Math.sin(6.0*x*Math.PI) + 20.0*Math.sin(2.0*x*Math.PI)) * 2.0 / 3.0;
	ret += (20.0*Math.sin(x*Math.PI) + 40.0*Math.sin(x/3.0*Math.PI)) * 2.0 / 3.0;
	ret += (150.0*Math.sin(x/12.0*Math.PI) + 300.0*Math.sin(x/30.0*Math.PI)) * 2.0 / 3.0;
	return ret;
}

function delta(lat, lng) {
	var a = 6378245.0;
	var ee = 0.00669342162296594323;
	var dLat = transformLat(lng-105.0, lat-35.0);
	var dLng = transformLon(lng-105.0, lat-35.0);
	var radLat = lat / 180.0 * Math.PI;
	var magic = Math.sin(radLat);
	magic = 1 - ee*magic*magic;
	var sqrtMagic = Math.sqrt(magic);
	dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
	dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
	return {"lat": dLat, "lng": dLng};
}

function gcj2wgs(gcjLat, gcjLng) {
	if (outOfChina(gcjLat, gcjLng)) {
		return {"lat": gcjLat, "lng": gcjLng};
	}
	var d = delta(gcjLat, gcjLng);
	return {"lat": gcjLat - d.lat, "lng": gcjLng - d.lng};
}

}());
