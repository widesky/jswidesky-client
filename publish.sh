#
# This is a script for publishing a release to both
# npm.org and github's npm
#

echo "Publishing to [npm.org] npm repository."
npm publish \
        --access public \
        --registry https://registry.npmjs.org

echo "Publishing to [github] npm repository."
npm publish \
        --access public \
        --registry https://npm.pkg.github.com

