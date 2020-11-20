#
# Run this to publish an official release to both of the
# npm.org and github npm repository.
#

echo "Building project..."
npm run build

echo "Publishing to [npm.org] npm repository."
npm publish \
        --access public \
        --registry https://registry.npmjs.org

echo "Publishing to [github] npm repository."
npm publish \
        --access public \
        --registry https://npm.pkg.github.com

