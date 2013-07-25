var backbeam = require('../backbeam')

backbeam.configure({
	host: 'backbeamapps.dev',
	port: '8079',
	project: 'callezeta',
	shared: '5bd82df918d542f181f9308008f229c335812ba4',
	secret: 'c7b7726df5a0e96304cd6e1d44e86036038191826b52bc11dff6e2a626ea1c46b0344dcc069a14dd',
	env:'dev'
})

// 

// backbeam.select('place').near('location', 41.641113, -0.895115, 10, function(err, objects, distances) {
// 	console.log('err', err)
// 	for (var i = 0; i < objects.length; i++) {
// 		console.log('object', objects[i].get('name'), distances[i], objects[i].get('location'))
// 	}
// })


// ne 41.645883 -0.889163
// sw 41.634113 -0.902896

// backbeam.select('place').query('join asdfasfasdf').bounding('location', 41.634113, -0.902896, 41.645883, -0.889163, 10, function(err, objects) {
// 	console.log('err', err)
// 	// for (var i = 0; i < objects.length; i++) {
// 	// 	console.log('object', objects[i].get('name'), objects[i].get('location'))
// 	// }
// })

backbeam.select('event').query('where name like ?', 'slap').fetch(10, 0, function(err, objects) {
	if (err) return console.log('err', err)
	for (var i = 0; i < objects.length; i++) {
		console.log('object', objects[i].get('name'), objects[i].get('location'))
	}
})
