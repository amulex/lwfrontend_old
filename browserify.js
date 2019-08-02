const browserify = require('browserify');
const tsify = require('tsify');
const entrypointSourceFile = process.argv[2];
const target = process.argv[3];

browserify()
    .add(entrypointSourceFile)
    .plugin(tsify, {target})
    .bundle()
    .on('error', (error) => console.error(error.toString()))
    .pipe(process.stdout);
