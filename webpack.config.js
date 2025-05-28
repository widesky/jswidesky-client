const TerserPlugin = require("terser-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");

module.exports = (env, argv) => ({
    mode: argv.mode,
    devtool: argv.mode === "production" ? undefined : "inline-source-map",
    entry: {
        index: [`./index.js`],
    },
    output: {
        library: {
            type: "umd",
            name: "JsWideSky",
            umdNamedDefine: true,
        },
        globalObject: "this",
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                "LICENSE",
                "package.json",
                "CHANGELOG.md",
                "README.md",
                { from: "docs/client", to: "docs" },
            ],
        }),
        // fix "process is not defined" error, so that bunyan (util module) can run in the browser
        new webpack.ProvidePlugin({
            process: "process/browser",
        }),
    ],
    optimization: {
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        drop_console: true,
                    },
                    output: {
                        ascii_only: true,
                    },
                },
            }),
        ],
    },
    resolve: {
        fallback: {
            net: false,
            url: false,
            tls: false,
            http: false,
            https: false,
            http2: false,
            readline: false,
            // Polyfill Node modules to allow bunyan to run in the browser
            stream: require.resolve("stream-browserify"),
            util: require.resolve("util/"),
            assert: require.resolve("assert/"),
            buffer: require.resolve("buffer/"),
        },
    },
    externals: [
        "dtrace-provider",
        "fs",
        "mv",
        "os",
        "source-map-support"
    ],
});
