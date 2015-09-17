var WallStyler = angular.module('WallStyler', ['ngAnimate', 'toastr']);

WallStyler.directive('ngEnter', function () {
    return function (scope, element, attrs) {
        element.bind("keydown keypress", function (event) {
            if (event.which === 13) {
                scope.$apply(function () {
                    scope.$eval(attrs.ngEnter);
                });

                event.preventDefault();
            }
        });
    };
});

WallStyler.config(function (toastrConfig) {
	angular.extend(toastrConfig, {
		autoDismiss: true,
		positionClass: 'toast-bottom-right'
	});
});