(function(undefined) {
	window.backbeam = window.backbeam || {}

	backbeam.createClient = function(options) {
		options.host = options.host || 'backbeam.io'
		options.port = options.port || '80'
		options.env  = options.env  || 'dev'

		var fileURL = function(id, params) {
			var params = params ? '?'+$.param(params) : ''
			return 'http://'+options.project+'.'+options.host+':'+options.port+'/file/'+options.env+'/'+id+params
		}

		var request = function(method, path, params, callback) {
			var prms = method !== 'GET' ? {_method:method} : {}
			for (var key in params) { prms[key] = params[key] }

			var url = 'http://api.'+options.env+'.'+options.project+'.'+options.host+':'+options.port+path
			$.ajax({
				type:'GET',
				url:url,
				data:prms,
				dataType:'jsonp',
				success: function(data, status, xhr) {
					callback(null, data)
				},
				error: function(xhr, errorType, err) {
					console.log('error', errorType, err)
					callback(err)
				}
			})
		}

		var empty = function(entity) {
			var obj = {
				entity: entity,
				createdAt: null,
				updatedAt: null,
				id: null,
				values: {},
				set: function(field, _new) {
					this.values[field] = _new
				},
				get: function(field) {
					return this.values[field]
				}
			}

			obj.insert = function(callback) {
				request('POST', '/data/'+entity, obj.values, function(error, data) {
					if (error) { return callback(error) }
					if (data.object) { obj.fill(data.object) }
					callback(null, obj, data.status)
				})
			}

			obj.update = function(callback) {
				// TODO: if not obj.id
				request('PUT', '/data/'+entity+'/'+obj.id, obj.values, function(error, data) {
					if (error) { return callback(error) }
					if (data.object) { obj.fill(data.object) }
					callback(null, obj, data.status)
				})
			}

			obj.remove = function(callback) {
				// TODO: if not obj.id
				request('DELETE', '/data/'+entity+'/'+obj.id, {}, function(error, data) {
					if (error) { return callback(error) }
					if (data.object) { obj.fill(data.object) }
					callback(null, obj, data.status)
				})
			}

			obj.fill = function(object, references) {
				for (var field in object) {
					var value = object[field]
					if (field === 'created_at') {
						obj.createdAt = new Date(value)
					} else if (field === 'updated_at') {
						obj.updatedAt = new Date(value)
					} else if (field === 'id') {
						obj.id = value
					} else if (field === 'type') {
						obj.entity = value
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
								}
							}
							field = field.substring(0, i)
							obj.set(field, value)
						}
					}
				}
			}

			return obj
		}

		var normalizeObject = function(object, references) {
			var obj = empty(null)
			obj.fill(object, references)
			return obj
		}

		var normalizeArray = function(objects, references) {
			var objs = []
			for (var i = 0; i < objects.length; i++) {
				var object = objects[i]
				objs.push(normalizeObject(objects[i], references))
			}
			return objs
		}

		var normalizeDictionary = function(references) {
			var refs = {}
			for (var id in references) {
				var object = references[id]
				refs[id] = normalizeObject(object)
				refs[id].id = id
			}
			return refs
		}

		var select = function(entity) {
			var q, params
			return {
				query: function() {
					var args = Array.prototype.slice.call(arguments)
					q = args[0]
					if (args[1] && args[1].constructor == Array) { params = args[1] }
					else { params = args.slice(1, args.length) }
					return this
				},
				fetch: function(limit, offset, callback) {
					request('GET', '/data/'+entity, { q:q, params:params, limit:limit, offset:offset }, function(error, data) {
						if (error) { return callback(error) }
						var references = normalizeDictionary(data.references)
						var objs = normalizeArray(data.objects, references)
						callback(null, objs)
					})
					return this
				},
				next: function(limit) {
					return this
				}
			}
		}

		return {
			request: request,
			select: select,
			fileURL: fileURL,
			empty: empty
		}
	}
})()