var bunyan = require('bunyan'),
    useragent = require('useragent'),
    util = require('util');


module.exports = function (opts) {
    var logger = module.exports.errorLogger(opts);
    return function (req, res, next) {
        logger(null, req, res, next);
    };
};


module.exports.errorLogger = function (logger) {
    var format, opts={},
        immediate = false,
        parseUA = true,
        levelFn = defaultLevelFn;

    // default format
    format = opts.format || ":remote-address :incoming :method :url HTTP/:http-version :status-code :res-headers[content-length] :referer :user-agent[family] :user-agent[major].:user-agent[minor] :user-agent[os] :response-time ms";
    delete opts.format; // don't pass it to bunyan
    (typeof format != 'function') && (format = compile(format));

    opts.hasOwnProperty('parseUA') && (parseUA = opts.parseUA, delete opts.parseUA);

    if (opts.immediate) {
        immediate = opts.immediate;
        delete opts.immediate;
    }

    if (opts.levelFn) {
        levelFn = opts.levelFn;
        delete opts.levelFn;
    }

    return function (err, req, res, next) {
        var startTime = Date.now();

        function logging(incoming) {
            if(!incoming) {
                res.removeListener('finish', logging);
                res.removeListener('close', logging);
            }

            var app = req.app || res.app,
                status = res.statusCode,
                method = req.method,
                id = req.id || res.id,
                url = req.url || '-',
                ua = parseUA ? useragent.parse(req.header('user-agent')) : req.header('user-agent'),
                httpVersion = req.httpVersionMajor + '.' + req.httpVersionMinor,
                responseTime = Date.now() - startTime,
                ip, logFn;


            var level = levelFn(status, err);
            logFn = logger[level] ? logger[level] : logger.info;

            ip = ip || req.ip || req.connection.remoteAddress ||
                (req.socket && req.socket.remoteAddress) ||
                (req.socket.socket && req.socket.socket.remoteAddresss) ||
                '127.0.0.1';

            var meta = {
                'remote-address': ip,
                'ip': ip,
                'id': id,
                'method': method,
                'url': url,
                'user-agent': ua,
                'http-version': httpVersion,
                'response-time': responseTime,
                'status-code': status,
                'req-headers': req.headers,
                'res-headers': res._headers,
                'incoming':incoming?'-->':'<--'
            };

            err && (meta.err = err);
            logFn.call(logger, meta, format(meta));
        }


        if (immediate) {
            logging(true);
        }
        res.on('finish', logging);
        res.on('close', logging);


        next();
    };
};


function compile(fmt) {
    fmt = fmt.replace(/"/g, '\\"');
    var js = '  return "' + fmt.replace(/:([-\w]{2,})(?:\[([^\]]+)\])?/g, function (_, name, arg) {
        if (arg)
            return '"\n + (meta["' + name + '"] ? (meta["' + name + '"]["' + arg + '"]|| (typeof meta["' + name + '"]["' + arg + '"] === "number"?"0": "-")) : "-") + "';
        return '"\n    + ((meta["' + name + '"]) || (typeof meta["'+name+'"] === "number"?"0": "-")) + "';
    }) + '";';
    return new Function('meta', js);
}


function defaultLevelFn(status, err) {
    if (err || status >= 500) { // server internal error or error
        return "error";
    } else if (status >= 400) { // client error
        return "warn";
    }
    return "info";
}
