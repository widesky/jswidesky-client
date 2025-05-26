const TerserPlugin = require("terser-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

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
            fs: false,
            http: false,
            https: false,
        },
    },
    externals: {
        bunyan: "bunyan",
        "bunyan-format": "bunyan-format",
        "cli-progress": "cli-progress",
    },
});
