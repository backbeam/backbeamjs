backbeamjs
==========

Javascript SDK for backbeam.io

Create an object
----------------

    var client = backbeam.createClient({ project:'your_project' })
    

Queries
-------

To create a query use `select()`. You must pass the entity identifier:

    var events = client.select('event')
    
Optionally you can use BQL queries. The first argument is the BQL query and the second parameter is optional. It can be a single value or an array of values

    events.query('join place') // BQL without parameters
    events.query('where type=?', 'conference') // one parameter
    events.query('where type=? and start_date>?', ['conference', new Date()]) // array

Use `fetch()` to retrieve the result of the query. It needs 3 arguments. The first is the `limit` of objects to be returned. The second is the `offset`, and the third argument is a callback function with two arguments.

    events.fetch(10, 0, function(objects, references) {
        // do something with objects or references
    })

`objects` is an array of results, and `references` is a dictionary containing object ids as keys, and backbeam objects as values.
    
Query objects support chained method calls, so you can do everything in a single line:

    client.select('event').query('join place').fetch(10, 0, function(objs, refs) {
        // do something
    })
    
Objects
-------

The returned objects by a query have the following properties and methods:

* `id`. String containing the unique object identifier
* `createdAt`
* `updatedAt`
* `value(field)`. Returns the value of the given field
* `value(field, val)`. Sets the value of the given field