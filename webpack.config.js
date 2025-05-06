const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => ({
    target: "node",
    mode: argv.mode === "production" ? "production" : "development",
    devtool: argv.mode === "production" ? undefined : "inline-source-map",
    devServer:
        argv.mode === "production"
            ? undefined
            : {
                  open: true,
                  openPage: [`client/example.html`],
                  contentBase: path.join(__dirname, "/"),
                  watchContentBase: true,
                  port: 8080,
                  host: "localhost",
                  disableHostCheck: true,
              },
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
            bufferutil: false,
            "utf-8-validate": false,
        },
    },
    externals: ["dtrace-provider"],
});
