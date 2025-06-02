const path = require("path");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
    target: "web",
    mode: "development",
    entry: "./index.js",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "index.browser.js",
        library: {
            type: "umd",
            name: "JsWideSky",
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
        new webpack.ProvidePlugin({
            process: "process/browser",
        }),
    ],
    resolve: {
        fallback: {
            stream: require.resolve("stream-browserify"),
            http: false,
            https: false,
        },
    },
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
            assert: false,
            http: false,
            https: false,
            util: require.resolve("util/"),
            stream: require.resolve("stream-browserify"),
            buffer: false,
        },
    },
    externals: [
        "dtrace-provider",
        "fs",
        "mv",
        "os",
        "source-map-support",
        "http2-wrapper",
        "axios-http2-adapter",
        "cli-progress",
    ],
};
