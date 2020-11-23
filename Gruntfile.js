module.exports = function(grunt) {

    // Project configuration.
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        /* Step definition */
        browserify: {
            dist: {
                options: {
                    transform: [["babelify", { "presets": ['@babel/preset-env'] }]],
                    browserifyOptions: {
                        debug: true
                    }
                },
                files: {
                    "dist/wideskyClient.js": "index.js"
                }
            }
        },
        terser: {
            dist: {
                files: {
                    "dist/wideskyClient.min.js": ["dist/wideskyClient.js"]
                },
            }
        },
    });

    // These plugins provide necessary tasks.
    grunt.loadNpmTasks("grunt-browserify");
    grunt.loadNpmTasks("grunt-terser");

    // Tasks and their steps
    grunt.registerTask('default', ['build']);
    grunt.registerTask('build',
        [
            'browserify:dist',
            'terser:dist'
        ]);
};
