const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = (env, argv) => ({
    mode: argv.mode,
    devtool: argv.mode === "production" ? undefined : "inline-source-map",
    devServer: {
        open: true,
        openPage: [`client/example.html`],
        contentBase: path.join(__dirname, "/"),
        watchContentBase: true,
        port: 8080,
        host: argv.mode === "production" ? `localhost` : `localhost`,
        disableHostCheck: true,
    },
    entry: {
        jsWideSky: [`./index.js`],
    },
    // library building properties for (1-1)
    output: {
        path: path.join(__dirname, "/dist/"),
        filename:
            argv.mode === "production" ? `[name].min.js` : `[name].develop.js`,
        library: {
            type: "umd",
            name: "JsWideSky",
            umdNamedDefine: true,
        },
        globalObject: "this",
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
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /(node_modules|bower_components)/,
                use: [
                    {
                        loader: "babel-loader",
                    },
                ],
            },
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
    },
});
