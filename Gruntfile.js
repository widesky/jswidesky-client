module.exports = function(grunt) {

    // Project configuration.
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        /* Step definition */
        babel: {
            options: {
                sourceMap: false,
                presets: ["@babel/preset-env"]
            },
            dist: {
                files: {
                    'dist/wsClient.babel.js':
                        'dist/wsClient.concat.js'
                }
            }
        },
        copy: {
            // Move all source to dist
            files: {
                cwd: '.',
                src: [
                    './src/*'
                ],
                dest:'./dist/',
                expand: true
            }
        },
        concat: {
            // combine all source files into a js file
            dist: {
                src: ['dist/src/*.js'],
                dest: 'dist/wsClient.concat.js'
            }
        },
        clean: {
            build: {
                src: [
                    'dist/src/*.js',
                    'dist/src',
                    'dist/wsClient.babel.js',
                    'dist/wsClient.concat.js',
                ]
            }
        },
        uglify: {
            options: {
                // Uglify variable and function names
                mangle: true
            },
            build: {
                files: {
                    'dist/wsClient.js': [
                        'dist/wsClient.babel.js'
                    ]
                }
            }
        }
    });

    // These plugins provide necessary tasks.
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.loadNpmTasks('grunt-contrib-concat');
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-babel');

    // Tasks and their steps
    grunt.registerTask('default', ['build']);
    grunt.registerTask('build',
        [
            'copy',
            'concat',
            'babel',
            'uglify',
            'clean'
        ]);
};
