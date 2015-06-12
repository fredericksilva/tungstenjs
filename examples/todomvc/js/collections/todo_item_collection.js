/**
 * Todo App Demo for Tungsten.js
 */
'use strict';

var Model = require('../models/todo_item_model.js');
var Collection = require('../../../../adaptors/backbone').Collection;
var ItemCollection = Collection.extend({
  model: Model
});
module.exports = ItemCollection;
