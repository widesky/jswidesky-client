const TerserPlugin = require("terser-webpack-plugin");

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
