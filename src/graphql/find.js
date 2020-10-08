/*
 * vim: set tw=78 et ts=4 sw=4 si fileencoding=utf-8:
 */
const _ = require("lodash");

const TIMESERIES_NODE_NAME = "timeSeries";

const walkArray = function(walkAll, targetNode, curNode, curPath, found) {
    curNode.forEach((node, index) => {
        walkGraph(walkAll, targetNode, node, `${curPath}[${index}]`, found);
    });
}

/**
 * Walk a graphql response and look for the target node name.
 * If walkAll is true, then the algorithm will not stop its move after
 * encountering its target. That is, it will complete its walk.
 * Otherwise, the algorithm will stop walking when the target node is
 * found.
 *
 * @param walkAll a boolean flag to determine whether the algorithm stop upon locating the node
 * @param targetNode name of the to-be-found node
 * @param curNode the current iterating node
 * @param curPath the current path the code is on
 * @param found an object that consists of the found node and its path
 */
const walkGraph = function(walkAll, targetNode, curNode, curPath, found) {
    for (let nodename in curNode) {
        if (!_.has(curNode, nodename)) {
            continue;
        }

        if (nodename === targetNode) {
            found.target = {};
            found.target[nodename] = curNode[nodename];

            // Remove the first dot and append the dot node name
            found.path = `${curPath.slice(1)}.${nodename}`;

            if (!walkAll) {
                return;
            }
        }

        const node = curNode[nodename];
        if (_.isArray(node)) {
            walkArray(walkAll,
                targetNode, node, `${curPath}.${nodename}`, found);
        } else if (_.isObject(node)) {
            walkGraph(walkAll,
                targetNode, node, `${curPath}.${nodename}`, found);
        }
    }
}

/**
 * An utility for locating data from a Widesky graphql
 * response.
 * E.g. looking up the dataPoints of an aliased node
 **/
class Find {

    /**
     * Walk a grqphql response and attempt to locate desire
     * node.
     * Note: This function only returns one node, so if there
     * is more than one same name node then either the first or
     * the last encounter is returned. And this is dependent on the
     * walkAll flag.
     *
     * @param nodeName
     * @param graphqlResp
     * @param walkAll
     * @returns {{path: string, target: null}}
     */
    static node(nodeName, graphqlResp, walkAll) {
        const found = {
            target: null,
            path: ""
        };

        if (_.isString(graphqlResp)) {
            try {
                graphqlResp = JSON.parse(graphqlResp);
            }
            catch (error) {
                // Invalid graph resp - dont bother looking further
                nodeName = null;
            }
        }

        if (nodeName) {
            walkGraph(walkAll, nodeName, graphqlResp, "", found);
        }

        return found;
    }

    /**
     * Locate the timeseries node based on an aliased node name.
     *
     * @param aliasName Name of the node you have aliased on the graphql request.
     * @param graphqlResp Response of your graphql query.
     * @returns {{path: string, target: null}}
     * Target is the found timeseries node.
     * Path that can be used for locating the found timeseries node.
     */
    static timeseriesNode(aliasName, graphqlResp) {
        const found = {
            target: null,
            path: ""
        };

        if (_.isString(graphqlResp)) {
            try {
                graphqlResp = JSON.parse(graphqlResp);
            }
            catch (error) {
                // Invalid graph resp - dont bother looking further
                aliasName = null;
            }
        }

        if (aliasName) {
            const aliasNode = {
                target: null,
                path: ""
            };
            walkGraph(false, aliasName, graphqlResp, "", aliasNode);

            if (aliasNode.target) {
                walkGraph(true,
                    TIMESERIES_NODE_NAME, aliasNode.target, "", found);

                if (found.target) {
                    // Combine the 2 found paths together.
                    found.path = aliasNode.path.replace(aliasName, '') + found.path;
                }
            }
        }

        return found;
    }

}

module.exports = Find;
