/**
 * Todo App Demo for Tungsten.js
 */
'use strict';

var Model = require('../../../../adaptors/backbone').Model;
var ItemModel = Model.extend({
  toggle: function() {
    this.set({
      completed: !this.get('completed')
    });
  }
});
module.exports = ItemModel;
