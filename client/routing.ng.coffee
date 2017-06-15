import './app.ng.coffee'

Router = ($stateProvider, $urlRouterProvider, $locationProvider) ->
  $stateProvider
  .state('layout',
    abstract: true
    templateUrl: 'client/layout/layout.html'
    controller: 'LayoutCtrl'
  )
  .state('main',
    url: '/'
    templateUrl: 'client/main/main.html'
    controller: 'MainCtrl'
    parent: 'layout'
  )
  .state('ast',
    templateUrl: 'client/ast/ast.html'
    #controller: 'AstCtrl'
    parent: 'main'
  )
  .state('compilation-help',
    templateUrl: 'client/compilation-help/compilation-help.html'
    #controller: 'CompilationHelpCtrl'
    parent: 'main'
  )
  .state('fixed-input',
    templateUrl: 'client/fixed-input/fixed-input.html'
    #controller: 'FixedInputCtrl'
    parent: 'main'
  )
  .state('instructions',
    templateUrl: 'client/instructions/instructions.html'
    #controller: 'InstructionsCtrl'
    parent: 'main'
  )
  .state('variables',
    templateUrl: 'client/variables/variables.html'
    #controller: 'VariablesCtrl'
    parent: 'main'
  )
  .state('terminal',
    templateUrl: 'client/terminal/terminal.html'
    parent: 'main'
  )

  $urlRouterProvider.otherwise('/');

  $locationProvider.html5Mode(
    enabled: true
  )

app.config(['$stateProvider', '$urlRouterProvider', '$locationProvider', Router])