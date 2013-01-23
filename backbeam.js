(function(undefined) {

	var currentUser = null
	var options     = {}
	var socket      = null

	function BackbeamError(status, message) {
		this.name = status
		this.message = message || ''
	}
	BackbeamError.prototype = Error.prototype

	// function fireCallback() {
	// 	var args = Array.prototype.slice.call(arguments)
	// 	var callback = args[0]
	// 	var params = args.slice(1, args.length)
	// 	if (callback === console.log) {
	// 		callback.apply(console, params)
	// 	} else {
	// 		callback && callback.apply(null, params)
	// 	}
	// }

	var signature = function(data) {
		var tokens = []
		var keys = []
		for (var key in data) {
			if (data.hasOwnProperty(key)) keys.push(key)
		}
		keys.sort()
		for (var j = 0; j < keys.length; j++) {
			var key = keys[j]
			var value = data[key]
			if (value.constructor == Array) {
				value.sort()
				for (var i = 0; i < value.length; i++) {
					tokens.push(key+'='+value[i])
				}
			} else {
				tokens.push(key+'='+value)
			}
		}
		var signatureBaseString = tokens.join('&')
		if (typeof CryptoJS !== 'undefined') {
			return CryptoJS.HmacSHA1(signatureBaseString, options.secret).toString(CryptoJS.enc.Base64)
		} else if (typeof require !== 'undefined') {
			var crypto = require('crypto')
			return crypto.createHmac('sha1', new Buffer(options.secret, 'utf8')).update(new Buffer(signatureBaseString, 'utf8')).digest('base64')
		} else {
			throw new Error('CryptoJS library not found and no crypto module found')
		}
	}

	function nonce() {
		var random = Date.now()+':'+Math.random()
		if (typeof CryptoJS !== 'undefined') {
			return CryptoJS.SHA1(random).toString(CryptoJS.enc.Hex)
		} else if (typeof require !== 'undefined') {
			var crypto = require('crypto')
			return crypto.createHash('sha1').update(random).digest('hex')
		} else {
			throw new Error('CryptoJS library not found and no crypto module found')
		}
	}

	var request = function(method, path, params, callback) {
		var prms = {}
		for (var key in params) { prms[key] = params[key] }
		prms['nonce'] = nonce()
		prms['time'] = Date.now().toString()
		prms['key'] = options.shared
		prms['signature'] = signature(prms)

		var url = 'http://api.'+options.env+'.'+options.project+'.'+options.host+':'+options.port+path
		if (typeof $ !== 'undefined') {
			if (method !== 'GET') prms._method = method
			var req = $.ajax({
				type: 'GET',
				url: url,
				data: prms,
				dataType: 'jsonp',
				success: function(data, status, xhr) {
					callback(null, data)
				},
				// TODO: timeout
			})
			req.error(function(xhr, errorType, err) {
				callback(err)
			})
		} else if (typeof require !== 'undefined') {
			var opts = { url:url, method:method }
			if (method === 'GET') {
				opts.qs = prms
			} else {
				opts.form = prms
			}
			require('request')(opts, function(err, response, body) {
				if (err) { return callback(err) }
				try {
					var data = JSON.parse(body)
				} catch(e) {
					return callback(e)
				}
				callback(null, data)
			})
		} else {
			throw new Error('jQuery library not found and no "request" module found')
		}
	}

	function stringFromObject(obj, addEntity) {
		if (typeof obj === 'string') {
			return obj
		}
		if (typeof obj === 'number') {
			return ''+obj
		}
		if (obj && obj.id && typeof obj.id === 'function' && obj.entity && typeof obj.entity === 'function') {
			if (addEntity) {
				return obj.entity()+'/'+obj.id()
			} else {
				return obj.id()
			}
		}
		if (obj && obj.constructor && obj.constructor == Date) {
			return ''+obj.getTime()
		}
		// TODO: location
		return null
	}

	var empty = function(entity, _id, object, references) {
		var commands   = {}
		var values     = {}
		var entity     = entity
		var createdAt  = null
		var updatedAt  = null
		var identifier = _id || null

		var obj = {
			entity: function() {
				return entity
			},
			createdAt: function() {
				return createdAt
			},
			updatedAt: function() {
				return updatedAt
			},
			id: function() {
				return identifier
			},
			set: function(field, value) {
				var val = stringFromObject(value)
				if (val === null) { return false }
				values[field] = value
				commands['set-'+field] = val
				return true
			},
			add: function(field, obj) {
				var val = obj.id()
				if (!val) { return false }
				var key = 'add-'+field, arr = commands[key]
				if (!arr) {
					arr = []; commands[key] = arr
				}
				arr.push(val)
				return true
			},
			rem: function(field, obj) {
				var val = obj.id()
				if (!val) { return false }
				var key = 'rem-'+field, arr = commands[key]
				if (!arr) {
					arr = []; commands[key] = arr
				}
				arr.push(val)
				return true
			},
			get: function(field) {
				return values[field] || null // TODO: if empty string
			},
			fields: function() {
				var arr = []
				for (var key in values) {
					arr.push(key)
				}
				return arr
			}
		}

		obj.save = function(callback) {
			var method = null
			var path   = null
			if (identifier) {
				method = 'PUT'
				path   = '/data/'+entity+'/'+identifier
			} else {
				method = 'POST'
				path   = '/data/'+entity
			}
			request(method, path, commands, function(error, data) {
				if (error) { return callback(error) }
				var status = data.status
				if (!status) { return callback(new BackbeamError('InvalidResponse')) }
				if (status !== 'Success' && status !== 'PendingValidation') { return callback(new BackbeamError(status)) }
				if (data.object) { fill(data.object) }

				if (entity === 'user') {
					delete values['password']
				}
				if (entity === 'user' && method === 'POST') {
					backbeam.logout()
					if (data.status === 'Success') { // not PendingValidation
						setCurrentUser(obj)
					}
				}
				callback(null, obj)
			})
		}

		obj.refresh = function(callback) {
			// TODO: if not obj.id
			request('GET', '/data/'+entity+'/'+identifier, {}, function(error, data) {
				if (error) { return callback(error) }
				var status = data.status
				if (!status) { return callback(new BackbeamError('InvalidResponse')) }
				if (status !== 'Success') { return callback(new BackbeamError(status)) }
				if (data.object) { fill(data.object) }
				callback(null, obj)
			})
		}

		obj.remove = function(callback) {
			// TODO: if not obj.id
			request('DELETE', '/data/'+entity+'/'+identifier, {}, function(error, data) {
				if (error) { return callback(error) }
				var status = data.status
				if (!status) { return callback(new BackbeamError('InvalidResponse')) }
				if (status !== 'Success') { return callback(new BackbeamError(status)) }
				if (data.object) { fill(data.object) }
				callback(null, obj)
			})
		}

		obj.fileURL = function(params) {
			// TODO: if entity !== 'file'
			var params = params ? '?'+$.param(params) : ''
			return 'http://'+options.project+'.'+options.host+':'+options.port+'/file/'+options.env+'/'+identifier+params
		}

		function fill(object, references) {
			commands = {}
			for (var field in object) {
				var value = object[field]
				if (field === 'created_at') {
					createdAt = new Date(value)
				} else if (field === 'updated_at') {
					updatedAt = new Date(value)
				} else if (field === 'id') {
					identifier = value
				} else if (field === 'type') {
					entity = value
				} else {
					var i = field.indexOf('#')
					if (i > 0) {
						var type = field.substring(i+1, field.length)
						// TODO: check types
						if (type === 'r') {
							if (value.constructor == Object) {
								var arr = []
								var objs = value.result
								for (var j = 0; j < objs.length; j++) {
									var id = objs[j]
									arr.push(references[id])
								}
								value.result = arr
							} else {
								if (references) {
									value = references[value]
								} else {
									value = null
								}
							}
						}

						if (value) {
							field = field.substring(0, i)
							values[field] = value
						}
					}
				}
			}
		}

		fill(object, references)

		return obj
	}

	var normalizeObject = function(object, references, id, entity) {
		return empty(entity, id, object, references)
	}

	var normalizeArray = function(entity, objects, references) {
		if (!objects) return null
		var objs = []
		for (var i = 0; i < objects.length; i++) {
			var object = objects[i]
			objs.push(normalizeObject(objects[i], references, null, entity))
		}
		return objs
	}

	var normalizeDictionary = function(references) {
		var refs = {}
		for (var id in references) {
			var object = references[id]
			refs[id] = normalizeObject(object, null, id)
		}
		return refs
	}

	var select = function(entity) {
		var q, params
		return {
			query: function() {
				var args = Array.prototype.slice.call(arguments)
				q = args[0]
				var prms = null
				if (args[1] && args[1].constructor == Array) { prms = args[1] }
				else { prms = args.slice(1, args.length) }
				if (prms) {
					params = prms
					for (var i = 0; i < params.length; i++) {
						params[i] = stringFromObject(params[i], true) // TODO: if returns null?
					}
				}
				return this
			},
			fetch: function(limit, offset, callback) {
				request('GET', '/data/'+entity, { q:q || '', params:params || [], limit:limit, offset:offset }, function(error, data) {
					if (error) { return callback(error) }
					var status = data.status
					if (!status) { return callback(new BackbeamError('InvalidResponse')) }
					if (status !== 'Success') { return callback(new BackbeamError(status)) }
					var references = normalizeDictionary(data.references)
					var objs = normalizeArray(entity, data.objects, references)
					// fireCallback(callback, null, objs)
					callback(null, objs)
				})
				return this
			},
			next: function(limit) {
				return this
			}
		}
	}

	if (typeof window !== 'undefined') {
		var backbeam = window.backbeam = window.backbeam || {}
	}
	if (typeof module !== 'undefined') {
		var backbeam = module.exports = {}
	}

	backbeam.configure  = function(_options, callback) {
		options.host    = _options.host || options.host || 'backbeam.io'
		options.port    = _options.port || options.port || '80'
		options.env     = _options.env  || options.env  || 'dev'
		options.project = _options.project
		options.shared  = _options.shared
		options.secret  = _options.secret

		if (_options.realtime === true) {
			// TODO: this only works in the browser
			var url = 'http://'+options.host+':'+options.port+'/socket.io/socket.io.js'
			$.ajax({
				url: url,
				dataType: 'script',
				success: function() {
					socket = io.connect('http://'+options.host+':'+options.port)
					callback && callback()
				},
				failure: function() {
					console.log('err')
					// TODO
				}
			})
		} else {
			callback && callback()
		}
	}

	backbeam.setEventHandler = function(handler) {
		if (!socket) return false;
		socket.on('msg', handler)
		return true
	}

	function roomName(room) {
		return options.project+'/'+options.env+'/'+room
	}

	backbeam.subscribeToEvents = function(room) {
		if (!socket) return false;
		socket.emit('subscribe', { room:roomName(room) })
		return true
	}

	backbeam.unsubscribeFromEvents = function(room) {
		if (!socket) return false;
		socket.emit('unsubscribe', { room:roomName(room) })
		return true
	}

	backbeam.sendEvent = function(room, data) {
		if (!socket) return false;
		socket.emit('publish', { room:roomName(room), data:data })
		return true
	}

	backbeam.select = select
	backbeam.empty  = empty

	function setCurrentUser(object) {
		currentUser = object
	}

	backbeam.currentUser = function() {
		return currentUser
	}

	backbeam.logout = function() {
		currentUser = null
	}

	backbeam.login = function(email, password, callback) {
		request('POST', '/user/email/login', {email:email, password:password}, function(error, data) {
			if (error) { return callback(error) }
			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status)) }
			var object = null
			if (data.object) {
				object = backbeam.empty('user', null, data.object, null)
				setCurrentUser(object)
			}
			callback(null, object)
		})
	}

	backbeam.requestPasswordReset = function(email, callback) {
		request('POST', '/user/email/lostpassword', {email:email}, function(error, data) {
			if (error) { return callback(error) }
			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status)) }
			callback(null)
		})
	}

})()