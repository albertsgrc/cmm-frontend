import angular from 'angular'
import angularMeteor from 'angular-meteor'
import uiRouter from 'angular-ui-router'
import ngMaterial from 'angular-material'
import 'angular/angular-csp.css'
import 'angular-material/angular-material.css'
import dataTable from 'angular-material-data-table'


@theme = "chaos"

import 'ace-builds/src-noconflict/ace'
import 'ace-builds/src-noconflict/mode-c_cpp'
import 'ace-builds/src-noconflict/theme-twilight'

import 'jquery.terminal/js/jquery.terminal'
import 'jquery.terminal/css/jquery.terminal.css'

import 'angular-resizable/angular-resizable.min.js'
import 'angular-resizable/angular-resizable.min.css'

import 'angular-material-data-table/dist/md-data-table.css'


DEPENDENCIES = [
    angularMeteor
    uiRouter
    ngMaterial
    dataTable
    'angularResizable'
]

@app = angular.module('cmm', DEPENDENCIES)

styler = ($mdThemingProvider) ->
    $mdThemingProvider.theme('default')
        .primaryPalette('blue')
        .accentPalette('pink')

@app.config(['$mdThemingProvider', styler])