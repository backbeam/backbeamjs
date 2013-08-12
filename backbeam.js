(function(undefined) {

	var currentUser   = null
	var options       = {}
	var cache         = null
	var socket        = null
	var roomDelegates = {}
	var realtimeDelegates = []

	if (typeof window !== 'undefined') {
		var backbeam = window.backbeam = window.backbeam || {}
	}
	if (typeof module !== 'undefined') {
		var backbeam = module.exports = {}
	}

	// Code based on async.js https://github.com/caolan/async/blob/master/lib/async.js#L76
	if (typeof process === 'undefined' || !(process.nextTick)) {
		if (typeof setImmediate === 'function') {
			backbeam.nextTick = function (fn) {
				// not a direct alias for IE10 compatibility
				setImmediate(fn)
			}
		} else {
			backbeam.nextTick = function (fn) {
				setTimeout(fn, 0)
			}
		}
	} else {
		backbeam.nextTick = process.nextTick
	}
	// ---

	function serialize(params) {
		if (typeof require !== 'undefined' && typeof Titanium === 'undefined') {
			return require('querystring').stringify(params)
		}
		var str = []
		for (var key in params) {
			if (params.hasOwnProperty(key)) {
				var value = params[key]
				var _key = encodeURIComponent(key)
				if (value && value.constructor == Array) {
					for (var i = 0; i < value.length; i++) {
						str.push(_key+'='+encodeURIComponent(value[i]))
					}
				} else {
					str.push(_key+'='+encodeURIComponent(value))
				}
			}
		}
		return str.join('&')
	}

	function createBrowserRequester() {
		if (typeof XMLHttpRequest === 'undefined' && typeof Titanium === 'undefined') return null

		return function(method, url, params, headers, callback) {
			var xhr
			if (typeof Titanium !== 'undefined') {
				xhr = Titanium.Network.createHTTPClient()
			} else {
				xhr = new XMLHttpRequest()
			}
			var query = params ? serialize(params) : ''
			if (method === 'GET') {
				url += '?'+query
			}
			xhr.open(method, url, true)
			xhr.onload = function() {
				try {
					var data = JSON.parse(xhr.responseText)
				} catch(e) {
					return callback(e)
				}
				callback(null, data)
			}

			xhr.onerror = function(e) {
				callback(e)
			}

			if (headers) {
				for (var name in headers) {
					if (headers.hasOwnProperty(name)) {
						xhr.setRequestHeader(name, headers[name])
					}
				}
			}

			if (method === 'GET') {
				xhr.send(null)
			} else {
				xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
				xhr.send(query)
			}
		}
	}

	function createNodeRequester() {
		if (typeof require === 'undefined') return null

		return function(method, url, params, headers, callback) {
			var opts = { url:url, method:method, headers:headers }
			if (method === 'GET') {
				opts.qs = params
			} else {
				opts.form = params
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
		}
	}

	function createFakeRequester() {
		return function() {
			throw new Error('Cannot load URL. Neither XMLHttpRequest nor require("request") were found')
		}
	}

	function createBrowserCrypter() {
		if (typeof CryptoJS === 'undefined') return null

		return {
			hmacSha1: function(message, secret) {
				return CryptoJS.HmacSHA1(message, secret).toString(CryptoJS.enc.Base64)
			},
			sha1: function(message) {
				return CryptoJS.SHA1(message).toString(CryptoJS.enc.Hex)
			},
			nonce: function() {
				var random = Date.now()+':'+Math.random()
				return CryptoJS.SHA1(random).toString(CryptoJS.enc.Hex)
			},
			base64: function(str) {
				var words = CryptoJS.enc.Utf8.parse(str)
				return CryptoJS.enc.Base64.stringify(words)
			}
		}
	}

	function createNodeCrypter() {
		if (typeof require === 'undefined') return null

		var crypto = require('crypto')
		return {
			hmacSha1: function(message, secret) {
				return crypto.createHmac('sha1', new Buffer(secret, 'utf8')).update(new Buffer(message, 'utf8')).digest('base64')
			},
			sha1: function(message) {
				return crypto.createHash('sha1').update(new Buffer(message, 'utf8')).digest('hex')
			},
			nonce: function() {
				var random = Date.now()+':'+Math.random()
				return crypto.createHash('sha1').update(random).digest('hex')
			},
			base64: function(str) {
				return new Buffer(str).toString('base64')
			}
		}
	}

	function createFakeCrypter() {
		return {
			hmacSha1: function() {
				throw new Error('Cannot calculate HMAC/SHA1. Neither CryptoJS nor require("crypto") were found')
			},
			nonce: function() {
				throw new Error('Cannot calculate secure nonce. Neither CryptoJS nor require("crypto") were found')
			}
		}
	}

	backbeam.requester = createBrowserRequester() || createNodeRequester() || createFakeRequester()
	backbeam.crypter   = createBrowserCrypter()   || createNodeCrypter()   || createFakeCrypter()

	function BackbeamError(status, message) {
		this.name = status
		this.message = message || ''
	}
	BackbeamError.prototype = Error.prototype

	var _ = {
		isArray: function(arr) {
			return arr.constructor.name === 'Array'
		},
		isFunction: function(f) {
			return typeof f === 'function'
		},
		isObject: function(o) {
			return o.constructor.name === 'Object'
		}
	}

	function guments(_arguments, callback) {
		var args = Array.prototype.slice.call(_arguments)
		var _callback = null
		if (callback) {
			if (args.length === 0) {
				throw new Error('callback function required')
			}
			_callback = args.pop()
			if (!_callback || typeof _callback != 'function') {
				throw new Error('callback is not a function')
			}
		}

		var self = {
			next: function(name, optional) {
				if (args.length === 0 && !optional)
					throw new Error('Missing argument `'+name+'`')
				return args.shift()
			},
			nextNumber: function(name, optional) {
				var o = self.next(name, optional)
				if (typeof o !== 'number') {
					throw new Error('`'+name+'` is not a number')
				}
				return o
			},
			nextArray: function(name, optional) {
				var o = self.next(name, optional)
				if (!o || !_.isArray(o)) {
					throw new Error('`'+name+'` is not an array')
				}
				return o
			},
			nextFunction: function(name, optional) {
				var o = self.next(name, optional)
				if (!_.isFunction(o)) {
					throw new Error('`'+name+'` is not a function')
				}
				return o
			},
			nextObject: function(name, optional) {
				var o = self.next(name, optional)
				if (o && (!_.isObject(o) || _.isFunction(o) || _.isArray(o))) {
					throw new Error('`'+name+'` is not an object')
				}
				return o
			},
			nextString: function(name, optional) {
				var o = self.next(name, optional)
				if (typeof o !== 'string') {
					throw new Error('`'+name+'` is not a string')
				}
				return o
			},
			rest: function() {
				if (args.length === 1 && _.isArray(args[0])) {
					args = args[0]
				}
				return args
			},
			callback: function() {
				return _callback
			}
		}
		return self
	}

	var canonicalString = function(data) {
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
				value = value.slice()
				value.sort()
				for (var i = 0; i < value.length; i++) {
					tokens.push(key+'='+value[i])
				}
			} else {
				tokens.push(key+'='+value)
			}
		}
		return tokens.join('&')
	}

	var signature = function(data) {
		var signatureBaseString = canonicalString(data)
		return backbeam.crypter.hmacSha1(signatureBaseString, options.secret)
	}

	var generateCacheString = function(data) {
		var signatureBaseString = canonicalString(data)
		return backbeam.crypter.sha1(signatureBaseString)
	}

	var signedRequest = function(method, path, params, policy, callback) {
		if (!options.shared || !options.secret) {
			return backbeam.nextTick(function() {
				callback(new Error('Bad configuration. Shared or secret API keys not set'))
			})
		}
		var prms = {}; for (var key in params) { prms[key] = params[key] }

		prms['method'] = method
		prms['path']   = path
		prms['key']    = options.shared

		if (cache && policy.indexOf('local') >= 0) {
			var cacheString = generateCacheString(prms)
			var data = cache.getItem(cacheString)
			if (data) {
				backbeam.nextTick(function() {
					return callback(null, data, true)
				})

				if (policy.indexOf('or') >= 0) {
					// we are done
					return
				}
			} else {
				if (policy.indexOf('remote') === -1) {
					// only local and local failed
					backbeam.nextTick(function() {
						return callback(new Error('CachedDataNotFound'))
					})
					return
				}
			}
		}

		prms['nonce']     = backbeam.crypter.nonce()
		prms['time']      = Date.now().toString()
		prms['signature'] = signature(prms)

		delete prms['method']
		delete prms['path']

		var url = options.protocol+'://api-'+options.env+'-'+options.project+'.'+options.host+':'+options.port+path
		backbeam.requester(method, url, prms, {}, function(err, data) {
			if (err) { return callback(err) }
			if (cache && policy.indexOf('local') >= 0) {
				cache.setItem(cacheString, data)
			}
			callback(null, data, false)

			if (policy.indexOf('local') >= 0) {
				cache.setItem(cacheString, data)
			}
		})
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
		if (obj && typeof obj.toString === 'function') {
			return obj.toString()
		}
		// TODO: location
		return null
	}

	var empty = function(entity, _id) {
		var commands   = {}
		var values     = {}
		var entity     = entity
		var createdAt  = null
		var updatedAt  = null
		var identifier = _id || null
		var extra      = {}

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
			incr: function(field, value) {
				var val = parseFloat(value) || 1
				values[field] += val // TODO: if not set previously
				commands['incr-'+field] = val
			},
			del: function(field) {
				delete values[field]
				commands['del-'+field] = '1'
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
			},
			toJSON: function () {
				var o = {}
				for (var key in values) {
					if (values.hasOwnProperty(key)) {
						o[key] = values[key]
					}
				}
				return o
			}
		}

		obj.save = function() {
			var args     = guments(arguments, true)
			var callback = args.callback()

			var method = null
			var path   = null
			if (identifier) {
				method = 'PUT'
				path   = '/data/'+entity+'/'+identifier
			} else {
				method = 'POST'
				path   = '/data/'+entity
			}
			signedRequest(method, path, commands, 'remote', function(error, data, fromCache) {
				if (error) { return callback(error) }
				var status = data.status
				if (!status) { return callback(new BackbeamError('InvalidResponse')) }
				if (status !== 'Success' && status !== 'PendingValidation') { return callback(new BackbeamError(status, data.errorMessage)) }
				var refs = {}; refs[data.id] = obj
				identifier = data.id
				var objects = objectsFromValues(data.objects, refs)

				if (entity === 'user' && method === 'POST') {
					backbeam.logout()
					if (data.status === 'Success') { // not PendingValidation
						setCurrentUser(obj)
					}
				}
				callback(null, obj)
			})
		}

		obj.refresh = function() {
			var args   = guments(arguments, true)
			var joins  = args.next('joins', true)
			var callback = args.callback()

			// TODO: if not identifier
			var params = {}
			if (joins) params.joins = joins

			signedRequest('GET', '/data/'+entity+'/'+identifier, params, 'remote', function(error, data, fromCache) {
				if (error) { return callback(error) }
				var status = data.status
				if (!status) { return callback(new BackbeamError('InvalidResponse')) }
				if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
				var refs = {}; refs[data.id] = obj
				var objects = objectsFromValues(data.objects, refs)
				callback(null, obj)
			})
		}

		obj.remove = function() {
			var args = guments(arguments, true)
			var callback = args.callback()

			// TODO: if not identifier
			signedRequest('DELETE', '/data/'+entity+'/'+identifier, {}, 'remote', function(error, data, fromCache) {
				if (error) { return callback(error) }
				var status = data.status
				if (!status) { return callback(new BackbeamError('InvalidResponse')) }
				if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
				var refs = {}; refs[data.id] = obj
				var objects = objectsFromValues(data.objects, refs)
				callback(null, obj)
			})
		}

		obj.fileURL = function(params) {
			// TODO: if entity !== 'file'
			params = params || {}
			var path = null
			var version = obj.get('version')
			if (version) {
				path = '/data/file/download/'+identifier+'/'+obj.get('version')
			} else {
				path = '/data/file/download/'+identifier
			}
			params['path'  ] = path
			params['method'] = 'GET'
			params['key']       = options.shared
			params['signature'] = signature(params)
			delete params['path']
			delete params['method']
			var base = options.protocol+'://api-'+options.env+'-'+options.project+'.'+options.host+':'+options.port+path
			return base+'?'+serialize(params)
		}

		obj._fill = function(vals, references) {
			commands = {}
			extra = {}
			for (var field in vals) {
				var value = vals[field]
				if (field === 'created_at') {
					createdAt = new Date(value)
				} else if (field === 'updated_at') {
					updatedAt = new Date(value)
				} else {
					var i = field.indexOf('#')
					if (i > 0) {
						var type = field.substring(i+1, field.length)
						// TODO: check types
						if (type === 'r') {
							if (value.constructor == Object) {
								if (value.id && value.type) {
									value = references[value.id] || empty(value.type, value.id)
								} else if (value.result && value.count) {
									var arr = []
									var objs = value.result
									for (var j = 0; j < objs.length; j++) {
										var id = objs[j]
										arr.push(references[id])
									}
									value.result = arr
								}
							} else {
								if (references) {
									value = references[value]
								} else {
									value = null
								}
							}
						} else if (type === 'd') {
							value = new Date(parseInt(value, 10) || 0)
						} else if (type === 'n') {
							value = parseFloat(value) || 0
						}

						if (value) {
							field = field.substring(0, i)
							values[field] = value
						}
					} else if (field.indexOf('login_') === 0) {
						extra[field.substring('login_'.length)] = value
					}
				}
			}
		}

		obj.getLoginData = function(provider, key) {
			key = provider+'_'+key
			return extra[key]
		}

		obj.getTwitterData = function(key) {
			return obj.getLoginData('tw', key)
		}

		obj.getFacebookData = function(key) {
			return obj.getLoginData('facebook', key)
		}

		return obj
	}

	var objectsFromValues = function(values, objects) {
		objects = objects || {}
		for (var id in values) {
			var obj = objects[id]
			if (obj) continue
			objects[id] = empty(values[id].type, id)
		}
		for (var id in values) {
			var obj = objects[id]
			var dict = values[id]
			obj._fill(dict, objects)
		}
		return objects
	}

	var select = function(entity) {
		var policy = 'remote'
		var q, params
		return {
			policy: function(value) {
				policy = value
				return this
			},
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
			fetch: function() {
				var args     = guments(arguments, true)
				var limit    = args.nextNumber('limit')
				var offset   = args.nextNumber('offset')
				var callback = args.callback()

				signedRequest('GET', '/data/'+entity, { q:q || '', params:params || [], limit:limit, offset:offset }, policy, function(error, data, fromCache) {
					if (error) { return callback(error) }
					var status = data.status
					if (!status) { return callback(new BackbeamError('InvalidResponse')) }
					if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
					var objects = objectsFromValues(data.objects, null)
					var objs = []
					for (var i = 0; i < data.ids.length; i++) {
						objs.push(objects[data.ids[i]])
					}
					callback(null, objs, data.count, fromCache)
				})
				return this
			},
			near: function() {
				var args     = guments(arguments, true)
				var field    = args.nextString('field')
				var lat      = args.nextNumber('lat')
				var lon      = args.nextNumber('lon')
				var limit    = args.nextNumber('limit')
				var callback = args.callback()

				var _params = {
					q      : q || '',
					params : params || [],
					limit  : limit,
					lat    : lat,
					lon    : lon,
				}

				signedRequest('GET', '/data/'+entity+'/near/'+field, _params, policy, function(error, data, fromCache) {
					if (error) { return callback(error) }
					var status = data.status
					if (!status) { return callback(new BackbeamError('InvalidResponse')) }
					if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
					var objects = objectsFromValues(data.objects, null)
					var objs = []
					for (var i = 0; i < data.ids.length; i++) {
						objs.push(objects[data.ids[i]])
					}
					callback(null, objs, data.distances, fromCache)
				})
				return this
			},
			bounding: function() {
				var args     = guments(arguments, true)
				var field    = args.nextString('field')
				var swlat    = args.nextNumber('swlat')
				var swlon    = args.nextNumber('swlon')
				var nelat    = args.nextNumber('nelat')
				var nelon    = args.nextNumber('nelon')
				var limit    = args.nextNumber('limit')
				var callback = args.callback()

				var _params = {
					q      : q || '',
					params : params || [],
					limit  : limit,
					swlat  : swlat,
					nelat  : nelat,
					swlon  : swlon,
					nelon  : nelon
				}

				signedRequest('GET', '/data/'+entity+'/bounding/'+field, _params, policy, function(error, data, fromCache) {
					if (error) { return callback(error) }
					var status = data.status
					if (!status) { return callback(new BackbeamError('InvalidResponse')) }
					if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
					var objects = objectsFromValues(data.objects, null)
					var objs = []
					for (var i = 0; i < data.ids.length; i++) {
						objs.push(objects[data.ids[i]])
					}
					callback(null, objs, fromCache)
				})
				return this
			}
		}
	}

	function loadScript(src, callback) {
		var script = document.createElement('script')
		script.type = 'text/javascript'
		script.src = src
		script.onload = script.onreadystatechange = function() {
			if (callback && (!this.readyState || this.readyState == 'complete')) {
				callback(null); callback = null
			}
		}
		document.getElementsByTagName('head')[0].appendChild(script)
	}

	function loadSocketio(callback) {
		if (typeof io === 'undefined') {
			// TODO: this only works in the browser
			var base = options.protocol+'://api-'+options.env+'-'+options.project+'.'+options.host+':'+options.port
			try {
				loadScript(base+'/socket.io/socket.io.js', callback)
			} catch(e) {
				callback(new Error('Failed to load socket.io script'))
			}
		} else {
			callback()
		}
	}

	function fireConnectionEvent(name, arg) {
		for (var i = 0; i < realtimeDelegates.length; i++) {
			var f = realtimeDelegates[i][name]
			f && f(arg)
		}
	}

	function connect() {
		loadSocketio(function(err) {
			if (err) {
				return fireConnectionEvent('connectFailed', err)
			}
			var base = options.protocol+'://api-'+options.env+'-'+options.project+'.'+options.host+':'+options.port
			socket = io.connect(base)
			socket.on('msg', function(message) {
				if (message.room) {
					var arr = roomDelegates[message.room]
					var prefix = roomName('')
					if (message.room.indexOf(prefix) === 0) {
						var event = message.room.substring(prefix.length)
						if (arr) {
							var _message = {}
							for (var key in message) {
								if (key.indexOf('_') === 0) {
									_message[key.substring(1)] = message[key]
								}
							}
							for (var i = 0; i < arr.length; i++) {
								arr[i] && arr[i](event, _message)
							}
						}
					}
				}
			})
			// See exposed events: https://github.com/LearnBoost/socket.io/wiki/Exposed-events
			socket.on('disconnect', function() {
				fireConnectionEvent('disconnect')
			})
			socket.on('connecting', function() {
				fireConnectionEvent('connecting')
			})
			socket.on('connect_failed', function() {
				fireConnectionEvent('connectFailed')
			})
			socket.on('error', function() {
				fireConnectionEvent('connectFailed')
			})
			socket.on('connect', function() {
				for (var room in roomDelegates) {
					socket.emit('subscribe', { room:room })
				}
				fireConnectionEvent('connect')
			})
		})
	}

	backbeam.enableRealTime = function() {
		connect()
	}

	backbeam.configure   = function(_options) {
		options.host     = _options.host     || options.host     || 'backbeamapps.com'
		options.env      = _options.env      || options.env      || 'dev'
		options.protocol = _options.protocol || options.protocol || 'http'
		options.port     = _options.port     || options.port

		options.project  = _options.project
		options.shared   = _options.shared
		options.secret   = _options.secret

		options.webVersion = _options.webVersion
		options.httpAuth   = _options.httpAuth

		if (!options.port) {
			options.port = options.protocol === 'https' ? 443 : 80
		}

		if (typeof _options.cache === 'object') {
			if (_options.cache.type === 'customCache' && _options.cache.impl) {
				cache = _options.cache.impl
			} else {
				if (typeof require !== 'undefined') {
					var Cache = require('./cache.js')
				}
				if (_options.cache.type === 'default') {
					cache = new Cache()
				} else if (_options.cache.type === 'localStorage') {
					cache = new Cache(-1, false, new Cache.LocalStorageCacheStorage('backbeam'))
				} else if (_options.cache.type === 'customStorage') {
					cache = new Cache(-1, false, _options.cache.impl)
				}
			}
		}
	}

	backbeam.clearCache = function() {
		cache && cache.clear()
	}

	function roomName(event) {
		return options.project+'/'+options.env+'/'+event
	}

	backbeam.subscribeToRealTimeConnectionEvents = function(callback) {
		realtimeDelegates.push(callback)
	}

	backbeam.unsubscribeFromRealTimeConnectionEvents = function(callback) {
		var index = realtimeDelegates.indexOf(callback)
		if (index >= 0) {
			realtimeDelegates.splice(index, 1)
		}
	}

	backbeam.subscribeToRealTimeEvents = function(event, delegate) {
		var room = roomName(event)
		var arr = roomDelegates[room]
		if (!arr) {
			arr = roomDelegates[room] = []
			arr.push(delegate)
		}
		if (!socket) return false
		socket.emit('subscribe', { room:room })
		return true
	}

	backbeam.unsubscribeFromRealTimeEvents = function(event, delegate) {
		var room = roomName(event)
		var arr = roomDelegates[room]
		if (!arr) return
		var index = arr.indexOf(delegate)
		arr.splice(index, 1)
		if (!socket) return false;
		socket.emit('unsubscribe', { room:room })
		return true
	}

	backbeam.sendRealTimeEvent = function(event, _data) {
		if (!socket) return false
		var data = {}
		for (var key in _data) {
			data['_'+key] = _data[key]
		}
		data.room = roomName(event)
		socket.emit('publish', data)
		return true
	}

	backbeam.subscribeDeviceToChannels = function() {
		var args     = guments(arguments, true)
		var gateway  = args.nextString('gateway')
		var device   = args.nextString('device')
		var channels = args.rest()
		var callback = args.callback()

		var params = { token:device, gateway:gateway, channels:channels }
		signedRequest('POST', '/push/subscribe', params, 'remote', function(error, data, fromCache) {
			if (error) { return callback(error) }
			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
			callback(null)
		})
	}

	backbeam.unsubscribeDeviceFromChannels = function() {
		var args     = guments(arguments, true)
		var gateway  = args.nextString('gateway')
		var device   = args.nextString('device')
		var channels = args.rest()
		var callback = args.callback()

		var params = { token:device, gateway:gateway, channels:channels }
		signedRequest('POST', '/push/unsubscribe', params, 'remote', function(error, data, fromCache) {
			if (error) { return callback(error) }
			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
			callback(null)
		})
	}

	backbeam.subscribedChannels = function() {
		var args     = guments(arguments, true)
		var gateway  = args.nextString('gateway')
		var device   = args.nextString('device')
		var callback = args.callback()

		var params = { token:device, gateway:gateway }
		signedRequest('GET', '/push/subscribed-channels', params, 'remote', function(error, data, fromCache) {
			if (error) { return callback(error) }
			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
			callback(null, data.channels)
		})
	}

	backbeam.unsubscribeDeviceFromAllChannels = function() {
		var args     = guments(arguments, true)
		var gateway  = args.nextString('gateway')
		var device   = args.nextString('device')
		var callback = args.callback()

		var params = { token:device, gateway:gateway }
		signedRequest('POST', '/push/unsubscribe-all', params, 'remote', function(error, data, fromCache) {
			if (error) { return callback(error) }
			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
			callback(null)
		})
	}

	backbeam.sendPushNotification = function() {
		var args     = guments(arguments, true)
		var channel  = args.nextString('channel')
		var options  = args.nextObject('options')
		var callback = args.callback()

		options.channel = channel // TOOD: better clone the options object and not modify it
		signedRequest('POST', '/push/send', options, 'remote', function(error, data, fromCache) {
			if (error) { return callback(error) }
			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
			callback(null)
		})
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

	backbeam.read = function() {
		var args     = guments(arguments, true)
		var entity   = args.next('entity')
		var _id      = args.next('id')
		var joins    = args.next('joins', true)
		var callback = args.callback()

		var obj = empty(entity, _id)
		obj.refresh(joins, callback)
	}

	backbeam.login = function() {
		var args      = guments(arguments, true)
		var email     = args.next('email')
		var password  = args.next('password')
		var joins     = args.next('joins', true)
		var callback  = args.callback()

		var params = { email:email, password:password }
		if (joins) params.joins = joins

		signedRequest('POST', '/user/email/login', params, 'remote', function(error, data, fromCache) {
			if (error) { return callback(error) }
			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
			var objects = objectsFromValues(data.objects, null)
			var user = objects[data.id]
			if (user) {
				setCurrentUser(user) // TODO: data.auth
			}
			callback(null, user)
		})
	}

	backbeam.requestPasswordReset = function() {
		var args     = guments(arguments, true)
		var email    = args.next('email')
		var callback = args.callback()

		signedRequest('POST', '/user/email/lostpassword', {email:email}, 'remote', function(error, data, fromCache) {
			if (error) { return callback(error) }
			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
			callback(null)
		})
	}

	backbeam.socialSignup = function() {
		var args        = guments(arguments, true)
		var provider    = args.nextString('provider')
		var body        = args.nextObject('credentials')
		var joins       = args.next('joins', true)
		var params      = args.rest()
		var callback    = args.callback()

		if (joins)  body.joins = joins
		if (params) body.params = params

		signedRequest('POST', '/user/'+provider+'/signup', body, 'remote', function(error, data, fromCache) {
			if (error) { return callback(error) }
			var status = data.status
			var isNew = true
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status === 'UserAlreadyExists') { status = 'Success'; isNew = false }
			if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
			var objects = objectsFromValues(data.objects, null)
			var user = objects[data.id]
			if (user) {
				setCurrentUser(user) // TODO: data.auth
			} else {
				isNew = undefined
			}
			callback(null, user, isNew)
		})
	}

	backbeam.twitterSignup = function() {
		var args = ['twitter']
		for (var i = 0; i < arguments.length; i++) {
			args.push(arguments[i])
		}
		backbeam.socialSignup.apply(backbeam, args)
	}

	backbeam.facebookSignup = function() {
		var args = ['facebook']
		for (var i = 0; i < arguments.length; i++) {
			args.push(arguments[i])
		}
		backbeam.socialSignup.apply(backbeam, args)
	}

	function requestController(method, path, params, callback) {
		var prms = {}
		if (params) {
			for (var key in params) {
				prms[key] = params[key]
			}
		}
		var url = null
		if (options.webVersion) {
			url = options.protocol+'://web-'+options.webVersion+'-'+options.env+'-'+options.project+'.'+options.host+':'+options.port+path
		} else {
			url = options.protocol+'://web-'+options.env+'-'+options.project+'.'+options.host+':'+options.port+path
		}
		var headers = {}
		if (options.httpAuth) {
			headers['Authorization'] = 'Basic '+backbeam.crypter.base64(options.project+':'+options.httpAuth)
		}
		backbeam.requester(method, url, params, headers, callback)
	}

	backbeam.requestJSON = function() {
		var args        = guments(arguments, true)
		var method      = args.nextString('method')
		var path        = args.nextString('path')
		var params      = args.nextObject('params', true)
		var callback    = args.callback()

		requestController(method, path, params, function(err, data) {
			if (err) { return callback(err) }
			callback(null, data)
		})
	}

	backbeam.requestObjects = function() {
		var args        = guments(arguments, true)
		var method      = args.nextString('method')
		var path        = args.nextString('path')
		var params      = args.nextObject('params', true)
		var callback    = args.callback()

		requestController(method, path, params, function(err, data) {
			if (err) { return callback(err) }

			var status = data.status
			if (!status) { return callback(new BackbeamError('InvalidResponse')) }
			if (status !== 'Success') { return callback(new BackbeamError(status, data.errorMessage)) }
			var objects = objectsFromValues(data.objects, null)
			var objs = []
			for (var i = 0; i < data.ids.length; i++) {
				objs.push(objects[data.ids[i]])
			}
			callback(null, objs, data.count)
		})
	}

	backbeam.collection = function() {
		var arr = []

		function addWithPrefix(values, prefix) {
			for (var i = 0; i < values.length; i++) {
				var value = values[i]
				if (value) {
					if (_.isArray(value)) {
						for (var i = 0; i < value.length; i++) {
							arr.push(prefix+value[i])
						}
					} else {
						arr.push(prefix+value)
					}
				}
			}
		}

		var obj = {
			add: function() {
				for (var i = 0; i < arguments.length; i++) {
					var value = arguments[i]
					if (value) {
						if (typeof value.id === 'function') {
							arr.push(value.id())
						} else if (_.isArray(value)) {
							for (var i = 0; i < value.length; i++) {
								arr.push(value[i])
							}
						} else {
							arr.push(value)
						}
					}
				}
				return this
			},
			addTwitter: function() {
				addWithPrefix(arguments, 'tw:')
				return this
			},
			addFacebook: function() {
				addWithPrefix(arguments, 'fb:')
				return this
			},
			addEmail: function() {
				addWithPrefix(arguments, 'email:')
				return this
			},
			toString: function() {
				return arr.join('\n')
			}
		}
		if (arguments.length === 1) {
			if (_.isArray(arguments[0])) {
				obj.add(arguments[0])
			} else {
				obj.add(arguments[0])
			}
		} else {
			obj.add(Array.prototype.slice.call(arguments))
		}
		return obj
	}

})()
