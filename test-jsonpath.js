const jsonpath = require('jsonpath');
console.log(jsonpath.query({a: 1}, '$.a'));
