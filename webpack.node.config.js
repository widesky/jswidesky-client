const TerserPlugin = require("terser-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const path = require("path");

module.exports = {
    target: "node",
    mode: "production",
    entry: "./index.js",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "index.js",
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
    externals: ["dtrace-provider", "bufferutil", "utf-8-validate"],
};
