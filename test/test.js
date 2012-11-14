
before(function(done) {
	backbeam.configure({ project:'callezeta', host:'backbeam.dev', port:'8080', env:'dev' })
	done()
})

describe('Test backbeam', function() {
	it('Test empty query', function(done) {
		backbeam.select('place').fetch(100, 0, function(error, objects) {
			chai.assert.isNull(error)
			chai.assert.equal(objects.length, 0)
			done()
		})
	})

	it('Insert, update, refresh an object', function(done) {
		var location = {}

		var object = backbeam.empty('place')
		object.set('name', 'A new place')
		object.set('location', location)
		object.save(function(error) {
			chai.assert.isNull(error)
			chai.assert.ok(object.id())
			chai.assert.ok(object.createdAt())
			chai.assert.ok(object.updatedAt())
			chai.assert.equal(object.createdAt(), object.createdAt())

			object.set('name', 'New name')
			object.set('type', 'Terraza')
			object.save(function(error) {
				chai.assert.isNull(error)
				chai.assert.ok(object.id())
				chai.assert.ok(object.createdAt())
				chai.assert.ok(object.updatedAt())
				chai.assert.notEqual(object.createdAt(), object.updatedAt())

				var obj = backbeam.empty('place', object.id())
				obj.refresh(function(error) {
					chai.assert.isNull(error)
					chai.assert.ok(obj.id())
					chai.assert.ok(obj.createdAt())
					chai.assert.ok(obj.updatedAt())
					chai.assert.equal(object.createdAt().getTime(), obj.createdAt().getTime())

					obj.set('name', 'Final name')
					obj.save(function(error) {
						chai.assert.isNull(error)

						object.set('description', 'Some description')
						object.save(function(error) {
							chai.assert.isNull(error)

							chai.assert.equal(object.get('name'), obj.get('name'))
							done()
						})
					})
				})
			})
		})
	})

	it('Query with BQL and params', function(done) {
		backbeam.select('place').query('where type=?', ['Terraza']).fetch(100, 0, function(error, objects) {
			chai.assert.isNull(error)
			chai.assert.equal(objects.length, 1)
			chai.assert.equal(objects[0].entity(), 'place')
			chai.assert.equal(objects[0].get('name'), 'Final name')
			chai.assert.equal(objects[0].get('description'), 'Some description')
			done()
		})
	})

	it('Register, login', function(done) {
		var object = backbeam.empty('user')
		object.set('email', 'gimenete@gmail.com')
		object.set('password', '123456')
		object.save(function(error) {
			chai.assert.isNull(error)
			chai.assert.ok(backbeam.currentUser())
			chai.assert.equal(backbeam.currentUser().id(), object.id())
			chai.assert.isNull(object.get('password'))

			backbeam.logout()
			chai.assert.isNull(backbeam.currentUser())
			backbeam.login('gimenete@gmail.com', '123456', function(error, object) {
				chai.assert.isNull(error)
				chai.assert.ok(backbeam.currentUser())
				chai.assert.equal(backbeam.currentUser().id(), object.id())
				chai.assert.equal(backbeam.currentUser().get('name'), object.get('name'))
				chai.assert.isNull(backbeam.currentUser().get('password'))
				done()
			})
		})
	})

	it('User already registered', function(done) {
		var object = backbeam.empty('user')
		object.set('email', 'gimenete@gmail.com')
		object.set('password', '123456')
		object.save(function(error) {
			chai.assert.ok(error)
			chai.assert.equal(error.name, 'UserAlreadyExists')
			done()
		})
	})

	it('Unsuccessfull login. User not found', function(done) {
		backbeam.login('foo@example.com', 'xxxx', function(error, object) {
			chai.assert.ok(error)
			chai.assert.equal(error.name, 'UserNotFound')
			done()
		})
	})

	it('Unsuccessfull login. Wrong password', function(done) {
		backbeam.login('gimenete@gmail.com', 'xxxx', function(error, object) {
			chai.assert.ok(error)
			chai.assert.equal(error.name, 'InvalidCredentials')
			done()
		})
	})

	it('Request password reset', function(done) {
		backbeam.requestPasswordReset('gimenete@gmail.com', function(error, object) {
			chai.assert.isNull(error)
			done()
		})
	})
})
