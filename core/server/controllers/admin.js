var Ghost         = require('../../ghost'),
    _             = require('underscore'),
    fs            = require('fs-extra'),
    path          = require('path'),
    api           = require('../api'),
    moment        = require('moment'),
    errors        = require('../errorHandling'),

    ghost         = new Ghost(),
    dataProvider  = ghost.dataProvider,
    adminNavbar,
    adminControllers,
    loginSecurity = [];

 // TODO: combine path/navClass to single "slug(?)" variable with no prefix
adminNavbar = {
    content: {
        name: 'Content',
        navClass: 'content',
        key: 'admin.navbar.content',
        path: '/'
    },
    add: {
        name: 'New Post',
        navClass: 'editor',
        key: 'admin.navbar.editor',
        path: '/editor/'
    },
    settings: {
        name: 'Settings',
        navClass: 'settings',
        key: 'admin.navbar.settings',
        path: '/settings/'
    }
};


// TODO: make this a util or helper
function setSelected(list, name) {
    _.each(list, function (item, key) {
        item.selected = key === name;
    });
    return list;
}

// TODO: this could be a separate module
function getUniqueFileName(dir, name, ext, i, done) {
    var filename,
        append = '';

    if (i) {
        append = '-' + i;
    }

    filename = path.join(dir, name + append + ext);
    fs.exists(filename, function (exists) {
        if (exists) {
            setImmediate(function () {
                i = i + 1;
                return getUniqueFileName(dir, name, ext, i, done);
            });
        } else {
            return done(filename);
        }
    });
}

adminControllers = {
    'uploader': function (req, res) {

        var currentDate = moment(),
            month = currentDate.format('MMM'),
            year =  currentDate.format('YYYY'),
            tmp_path = req.files.uploadimage.path,
            imagespath = path.join(ghost.paths().appRoot, 'content/images'),
            dir = path.join(imagespath, year, month),
            ext = path.extname(req.files.uploadimage.name).toLowerCase(),
            type = req.files.uploadimage.type || req.files.uploadimage.headers['content-type'],
            basename = path.basename(req.files.uploadimage.name, ext).replace(/[\W]/gi, '_');

        function renameFile(target_path) {
            // adds directories recursively
            fs.mkdirs(dir, function (err) {
                if (err) {
                    return errors.logError(err);
                }

                fs.copy(tmp_path, target_path, function (err) {
                    if (err) {
                        return errors.logError(err);
                    }

                    fs.unlink(tmp_path, function (e) {
                        if (err) {
                            return errors.logError(err);
                        }

                        // the src for the image must be in URI format, not a file system path, which in Windows uses \
                        var src = path.join('/', target_path.replace(ghost.paths().appRoot, "")).replace(new RegExp('\\' + path.sep, 'g'), '/');
                        return res.send(src);
                    });
                });
            });
        }

        //limit uploads to type && extension
        if ((type === 'image/jpeg' || type === 'image/png' || type === 'image/gif')
                && (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.gif')) {
            getUniqueFileName(dir, basename, ext, null, function (filename) {
                renameFile(filename);
            });
        } else {
            res.send(415, 'Unsupported Media Type');
        }
    },
    'login': function (req, res) {
        res.render('login', {
            bodyClass: 'ghost-login',
            hideNavbar: true,
            adminNav: setSelected(adminNavbar, 'login')
        });
    },
    'auth': function (req, res) {
        var currentTime = process.hrtime()[0],
            denied = '';
        loginSecurity = _.filter(loginSecurity, function (ipTime) {
            return (ipTime.time + 2 > currentTime);
        });
        denied = _.find(loginSecurity, function (ipTime) {
            return (ipTime.ip === req.connection.remoteAddress);
        });

        if (!denied) {
            loginSecurity.push({ip: req.connection.remoteAddress, time: process.hrtime()[0]});
            api.users.check({email: req.body.email, pw: req.body.password}).then(function (user) {
                req.session.user = user.id;
                res.json(200, {redirect: req.body.redirect ? '/ghost/'
                    + decodeURIComponent(req.body.redirect) : '/ghost/'});
            }, function (error) {
                res.json(401, {error: error.message});
            });
        } else {
            res.json(401, {error: 'Slow down, there are way too many login attempts!'});
        }
    },
    changepw: function (req, res) {
        api.users.changePassword({
            currentUser: req.session.user,
            oldpw: req.body.password,
            newpw: req.body.newpassword,
            ne2pw: req.body.ne2password
        }).then(function () {
            res.json(200, {msg: 'Password changed successfully'});
        }, function (error) {
            res.send(401, {error: error.message});
        });

    },
    'signup': function (req, res) {
        res.render('signup', {
            bodyClass: 'ghost-signup',
            hideNavbar: true,
            adminNav: setSelected(adminNavbar, 'login')
        });
    },

    'doRegister': function (req, res) {
        var name = req.body.name,
            email = req.body.email,
            password = req.body.password;

        api.users.add({
            name: name,
            email: email,
            password: password
        }).then(function (user) {
            api.settings.edit('email', email).then(function () {
                if (req.session.user === undefined) {
                    req.session.user = user.id;
                }
                res.json(200, {redirect: '/ghost/'});
            });
        }).otherwise(function (error) {
            res.json(401, {error: error.message});
        });

    },

    'forgotten': function (req, res) {
        res.render('forgotten', {
            bodyClass: 'ghost-forgotten',
            hideNavbar: true,
            adminNav: setSelected(adminNavbar, 'login')
        });
    },

    'resetPassword': function (req, res) {
        var email = req.body.email;

        api.users.forgottenPassword(email).then(function (user) {
            var message = {
                    to: email,
                    subject: 'Your new password',
                    html: "<p><strong>Hello!</strong></p>" +
                          "<p>You've reset your password. Here's the new one: " + user.newPassword + "</p>" +
                          "<p>Ghost <br/>" +
                          '<a href="' + ghost.config().url + '">' +
                           ghost.config().url + '</a></p>'
                };

            return ghost.mail.send(message);
        }).then(function success() {
            var notification = {
                type: 'success',
                message: 'Your password was changed successfully. Check your email for details.',
                status: 'passive',
                id: 'successresetpw'
            };

            return api.notifications.add(notification).then(function () {
                res.json(200, {redirect: '/ghost/signin/'});
            });

        }, function failure(error) {
            res.json(401, {error: error.message});
        }).otherwise(errors.logAndThrowError);
    },
    'logout': function (req, res) {
        req.session = null;
        var notification = {
            type: 'success',
            message: 'You were successfully signed out',
            status: 'passive',
            id: 'successlogout'
        };

        return api.notifications.add(notification).then(function () {
            res.redirect('/ghost/signin/');
        });
    },
    'index': function (req, res) {
        res.render('content', {
            bodyClass: 'manage',
            adminNav: setSelected(adminNavbar, 'content')
        });
    },
    'editor': function (req, res) {
        if (req.params.id !== undefined) {
            res.render('editor', {
                bodyClass: 'editor',
                adminNav: setSelected(adminNavbar, 'content')
            });
        } else {
            res.render('editor', {
                bodyClass: 'editor',
                adminNav: setSelected(adminNavbar, 'add')
            });
        }
    },
    'content': function (req, res) {
        res.render('content', {
            bodyClass: 'manage',
            adminNav: setSelected(adminNavbar, 'content')
        });
    },
    'settings': function (req, res, next) {

        // TODO: Centralise list/enumeration of settings panes, so we don't
        // run into trouble in future.
        var allowedSections = ['', 'general', 'user'],
            section = req.url.replace(/(^\/ghost\/settings[\/]*|\/$)/ig, '');

        if (allowedSections.indexOf(section) < 0) {
            return next();
        }

        res.render('settings', {
            bodyClass: 'settings',
            adminNav: setSelected(adminNavbar, 'settings')
        });
    },
    'debug': { /* ugly temporary stuff for managing the app before it's properly finished */
        index: function (req, res) {
            res.render('debug', {
                bodyClass: 'settings',
                adminNav: setSelected(adminNavbar, 'settings')
            });
        }
    }
};

module.exports = adminControllers;
