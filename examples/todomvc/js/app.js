var TungstenBackboneBase = require('../../../adaptors/backbone');
var AppView = require('./views/todo_app_view');
var AppModel = require('./models/todo_app_model');
var template = require('../templates/todo_app_view.mustache');
var _ = require('underscore');
TungstenBackboneBase.setDynamicResolver(require.context('../templates', true, /\.mustache$/));

module.exports = new AppView({
  el: '#appwrapper',
  template: template,
  model: new AppModel(_.extend(window.data, {
    // Dynamic partials can be declared as part of data
    // The key is the name of the partial referenced in the template, after the indicating prefix (dyn_)
    // Value is the relative path to the template from the resolver set above (minus .mustache)
    dynamic_partials: {
      'todo_item_view': './todo_item_view'
    }
  }))
});