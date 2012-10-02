(function(undefined) {
	window.backbeam = window.backbeam || {}

	backbeam.createClient = function(options) {
		options.host = options.host || 'backbeam.io'
		options.port = options.port || '80'

		var fileURL = function(id, params) {
			var params = params ? '?'+$.param(params) : ''
			return 'http://'+options.project+'.'+options.host+':'+options.port+'/file/'+id+params
		}

		var request = function(method, path, params, body, success, error) {
			var url = 'http://'+options.project+'.'+options.host+':'+options.port+path
			$.ajax({
				type:method,
				url:url,
				data:params,
				dataType:'jsonp',
				jsonpCallback:'_c',
				success: function(data, status, xhr) {
					// console.log('data', data, status)
					success(data)
				},
				error: function(xhr, errorType, err) {
					console.log('error', errorType, err)
					error(errorType, error)
				}
			})
		}

		var normalizeObject = function(object) {
			var obj = {
				createdAt: null,
				updatedAt: null,
				id: null,
				values: {},
				value: function(field, _new) {
					if (typeof _new === 'undefined') {
						return this.values[field]
					}
					this.values[field] = _new
				}
			}
			for (var field in object) {
				var value = object[field]
				if (field === '_created_at') {
					obj.createdAt = new Date(value)
				} else if (field === '_updated_at') {
					obj.updatedAt = new Date(value)
				} else if (field === '_id') {
					obj.id = value
				} else {
					obj.value(field, value)
				}
			}
			return obj
		}

		var normalizeArray = function(objects) {
			var objs = []
			for (var i = 0; i < objects.length; i++) {
				var object = objects[i]
				objs.push(normalizeObject(objects[i]))
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
				fetch: function(limit, offset, success, error) {
					request('GET', '/api/'+entity, { q:q, params:params, limit:limit, offset:offset }, {}, function(data) {
						var objs = normalizeArray(data.objects)
						var references = normalizeDictionary(data.references)
						success(objs, references)
					}, error)
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
			fileURL: fileURL
		}
	}
})()