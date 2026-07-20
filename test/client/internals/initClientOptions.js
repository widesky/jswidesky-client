const { expect } = require("chai");
const stubs = require("../../stubs");
const {getInstance} = require("../../stubs");
const lodash = require("lodash");

const DEFAULT_CLIENT_OPTIONS = require("./files/defaultClientOptions.json");

/**
 * Check that the options object matches the default, excluding what has been set.
 * @param clientOptions Client options object generated.
 * @param excludePaths Lodash path to be excluded from default value checks.
 * @param path The current nested path.
 */
function validateObject(clientOptions, excludePaths, path=[]) {
    const optionConfig = path.length > 0 ? lodash.get(DEFAULT_CLIENT_OPTIONS, path.join(".")) : DEFAULT_CLIENT_OPTIONS;
    for (const [key, defaultValue] of Object.entries(optionConfig)) {
        if (defaultValue instanceof Object) {
            validateObject(clientOptions, excludePaths, [...path, key]);
        } else {
            const thisPath = [...path, key].join(".");
            if (excludePaths.includes(thisPath)) {
                continue;
            }
            expect(lodash.get(clientOptions, thisPath)).to.equal(defaultValue,
                `Expected to find ${defaultValue} in clientOptions at path ${thisPath}`
                );
        }
    }
}

describe("client", () => {
    describe("initClientOptions", () => {
        let http;
        let log;
        let ws;

        beforeEach(() => {
            http = new stubs.StubHTTPClient();
            log = new stubs.StubLogger();
            ws = getInstance(http, log);
        })

        it("should have all default properties", async () => {
            expect(ws.clientOptions).to.eql(DEFAULT_CLIENT_OPTIONS);
        });

        describe("impersonateAs", () => {
            it("should accept string", async () => {
                ws.options = {
                    client: {
                        impersonateAs: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
                    }
                };
                await ws.initClientOptions();
                expect(ws.clientOptions.impersonateAs).to.equal("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
                validateObject(ws.clientOptions, ["impersonateAs"]);
            });

            it("should reject number", async () => {
                ws.options = {
                    client: {
                        impersonateAs: 12
                    }
                };
                try {
                    await ws.initClientOptions();
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("impersonateAs must be a `string` type, but the final value was: `12`.");
                }
            });

            it("should reject boolean", async () => {
                ws.options = {
                    client: {
                        impersonateAs: true
                    }
                };
                try {
                    await ws.initClientOptions();
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("impersonateAs must be a `string` type, but the final value was: `true`.");
                }
            });

            it("should reject object", async () => {
                ws.options = {
                    client: {
                        impersonateAs: {}
                    }
                };
                try {
                    await ws.initClientOptions();
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("impersonateAs must be a `string` type, but the final value was: `{}`.");
                }
            });
        });

        describe("acceptGzip", () => {
            it("should accept boolean", async () => {
                ws.options = {
                    client: {
                        acceptGzip: false
                    }
                };
                await ws.initClientOptions();
                expect(ws.clientOptions.acceptGzip).to.equal(false);
                validateObject(ws.clientOptions, ["acceptGzip"]);
            });

            it("should reject number", async () => {
                ws.options = {
                    client: {
                        acceptGzip: 12
                    }
                };
                try {
                    await ws.initClientOptions();
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("acceptGzip must be a `boolean` type, but the final value was: `12`.");
                }
            });

            it("should reject string", async () => {
                ws.options = {
                    client: {
                        acceptGzip: "true"
                    }
                };
                try {
                    await ws.initClientOptions();
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("acceptGzip must be a `boolean` type, but the final value was: `\"true\"`.");
                }
            });

            it("should reject object", async () => {
                ws.options = {
                    client: {
                        acceptGzip: {}
                    }
                };
                try {
                    await ws.initClientOptions();
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("acceptGzip must be a `boolean` type, but the final value was: `{}`.");
                }
            });
        });

        describe("batch", () => {
            it("rejects if not an object", async () => {
                ws.options = {
                    client: {
                        batch: 1
                    }
                };
                try {
                    await ws.initClientOptions();
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("batch must be a `object` type, but the final value was: `1`.");
                }
            });

            describe("hisRead", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                hisRead: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.hisRead must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisRead.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.hisRead.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisRead.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisRead.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisRead.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisRead.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisRead.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisRead.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisRead: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisRead.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });
            });

            describe("hisWrite", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                hisWrite: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.hisWrite must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisWrite.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.hisWrite.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisWrite.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisWrite.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisWrite.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisWrite.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisWrite.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisWrite.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisWrite.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.hisWrite.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("hisDelete", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                hisDelete: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.hisDelete must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDelete.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.hisDelete.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDelete.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisDelete.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisWrite: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisWrite.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDelete.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisDelete.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDelete.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisDelete.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDelete.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.hisDelete.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDelete: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDelete.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("create", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                create: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.create must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.create.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.create.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.create.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.create.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.create.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.create.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.create.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.create.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.create.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.create.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    create: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.create.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("update", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                update: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.update must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.update.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.update.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.update.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.update.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.update.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.update.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.update.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.update.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.update.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.update.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    update: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.update.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("deleteById", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                deleteById: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.deleteById must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteById.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.deleteById.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteById.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.deleteById.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteById.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.deleteById.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteById.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.deleteById.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteById.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.deleteById.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteById: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteById.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("deleteByFilter", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                deleteByFilter: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.deleteByFilter must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteByFilter.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.deleteByFilter.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });
                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.batchSize must be greater than or equal to 1");
                        }
                    });

                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteByFilter.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.deleteByFilter.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteByFilter.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.deleteByFilter.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteByFilter.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.deleteByFilter.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.deleteByFilter.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.deleteByFilter.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    deleteByFilter: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.deleteByFilter.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("hisReadByFilter", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                hisReadByFilter: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.hisReadByFilter must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisReadByFilter.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.hisReadByFilter.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisReadByFilter.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisReadByFilter.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisReadByFilter.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisReadByFilter.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisReadByFilter.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisReadByFilter.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("limit", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        limit: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisReadByFilter.limit).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisReadByFilter.limit"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        limit: true
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.limit must be a `number` type, but the final value was: `true`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        limit: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.limit must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        limit: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.limit must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisReadByFilter: {
                                        limit: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisReadByFilter.limit must be greater than or equal to 0");
                        }
                    });
                });
            });

            describe("addChildrenByFilter", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                addChildrenByFilter: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.addChildrenByFilter must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.addChildrenByFilter.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.addChildrenByFilter.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.addChildrenByFilter.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.addChildrenByFilter.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.addChildrenByFilter.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.addChildrenByFilter.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.addChildrenByFilter.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.addChildrenByFilter.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("limit", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        limit: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.addChildrenByFilter.limit).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.addChildrenByFilter.limit"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        limit: true
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.limit must be a `number` type, but the final value was: `true`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        limit: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.limit must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        limit: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.limit must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        limit: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.limit must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.addChildrenByFilter.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.addChildrenByFilter.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    addChildrenByFilter: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.addChildrenByFilter.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("updateByFilter", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                updateByFilter: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.updateByFilter must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateByFilter.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.updateByFilter.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateByFilter.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.updateByFilter.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateByFilter.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.updateByFilter.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateByFilter.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.updateByFilter.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("limit", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        limit: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateByFilter.limit).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.updateByFilter.limit"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        limit: true
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.limit must be a `number` type, but the final value was: `true`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        limit: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.limit must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        limit: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.limit must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        limit: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.limit must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateByFilter.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.updateByFilter.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateByFilter: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateByFilter.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("migrateHistory", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                migrateHistory: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.migrateHistory must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.migrateHistory.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.migrateHistory.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.migrateHistory.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.migrateHistory.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.migrateHistory.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.migrateHistory.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.migrateHistory.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.migrateHistory.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.migrateHistory.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.migrateHistory.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    migrateHistory: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.migrateHistory.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("hisDeleteByFilter", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                deleteByFilter: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.deleteByFilter must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDeleteByFilter.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.hisDeleteByFilter.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDeleteByFilter.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisDeleteByFilter.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDeleteByFilter.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisDeleteByFilter.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDeleteByFilter.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisDeleteByFilter.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        parallelDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.parallelDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("limit", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        limit: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDeleteByFilter.limit).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.hisDeleteByFilter.limit"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        limit: true
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.limit must be a `number` type, but the final value was: `true`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        limit: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.limit must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        limit: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.limit must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        limit: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.limit must be greater than or equal to 0");
                        }
                    });
                });

                describe("returnResult", () => {
                    it("should accept if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        returnResult: true
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.hisDeleteByFilter.returnResult).to.equal(true);
                        validateObject(ws.clientOptions, ["batch.hisDeleteByFilter.returnResult"]);
                    });

                    it("should reject if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        returnResult: 12
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.returnResult must be a `boolean` type, but the final value was: `12`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        returnResult: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    hisDeleteByFilter: {
                                        returnResult: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.hisDeleteByFilter.returnResult must be a `boolean` type, but the final value was: `{}`.");
                        }
                    });
                });
            });

            describe("updateOrCreate", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                updateOrCreate: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.updateOrCreate must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateOrCreate.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.updateOrCreate.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateOrCreate.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.updateOrCreate.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateOrCreate.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.updateOrCreate.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.updateOrCreate.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.updateOrCreate.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    updateOrCreate: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.updateOrCreate.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });
                });

                it("should reject if below 0", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                updateOrCreate: {
                                    parallelDelay: -1
                                }
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "batch.updateOrCreate.parallelDelay must be greater than or equal to 0");
                    }
                });
            });
            
            describe("multiFind", () => {
                it("rejects if not an object", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                multiFind: 1
                            }
                        }
                    };
                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal("batch.multiFind must be a `object` type, but the final value was: `1`.");
                    }
                });

                describe("batchSize", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchSize: 1
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.multiFind.batchSize).to.equal(1);
                        validateObject(ws.clientOptions, ["batch.multiFind.batchSize"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchSize: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.batchSize must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchSize: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchSize: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.batchSize must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchSize: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.batchSize must be greater than or equal to 1");
                        }
                    });
                });

                describe("batchDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.multiFind.batchDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.multiFind.batchDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.batchDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.batchDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 0", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        batchDelay: -1
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.batchDelay must be greater than or equal to 0");
                        }
                    });
                });

                describe("parallel", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        parallel: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.multiFind.parallel).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.multiFind.parallel"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        parallel: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.parallel must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        parallel: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.parallel must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        parallel: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.parallel must be a `number` type, but the final value was: `{}`.");
                        }
                    });

                    it("should reject if below 1", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        parallel: 0
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.parallel must be greater than or equal to 1");
                        }
                    });
                });

                describe("parallelDelay", () => {
                    it("should accept if number", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        parallelDelay: 12
                                    }
                                }
                            }
                        };
                        await ws.initClientOptions();
                        expect(ws.clientOptions.batch.multiFind.parallelDelay).to.equal(12);
                        validateObject(ws.clientOptions, ["batch.multiFind.parallelDelay"]);
                    });

                    it("should reject if boolean", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        parallelDelay: false
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.parallelDelay must be a `number` type, but the final value was: `false`.");
                        }
                    });

                    it("should reject if string", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        parallelDelay: "12"
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                        }
                    });

                    it("should reject if object", async () => {
                        ws.options = {
                            client: {
                                batch: {
                                    multiFind: {
                                        parallelDelay: {}
                                    }
                                }
                            }
                        };

                        try {
                            await ws.initClientOptions();
                            throw new Error("Should not have worked");
                        } catch (error) {
                            expect(error.message).to.equal(
                                "batch.multiFind.parallelDelay must be a `number` type, but the final value was: `{}`.");
                        }
                    });
                });

                it("should reject if below 0", async () => {
                    ws.options = {
                        client: {
                            batch: {
                                multiFind: {
                                    parallelDelay: -1
                                }
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "batch.multiFind.parallelDelay must be greater than or equal to 0");
                    }
                });
            })
        });

        describe("performOpInBatch", () => {
            it("rejects if not an object", async () => {
                ws.options = {
                    client: {
                        performOpInBatch: 1
                    }
                };
                try {
                    await ws.initClientOptions();
                    throw new Error("Should not have worked");
                } catch (error) {
                    expect(error.message).to.equal("performOpInBatch must be a `object` type, but the final value was: `1`.");
                }
            });

            describe("batchSize", () => {
                it("should accept if number", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchSize: 1
                            }
                        }
                    };
                    await ws.initClientOptions();
                    expect(ws.clientOptions.performOpInBatch.batchSize).to.equal(1);
                    validateObject(ws.clientOptions, ["performOpInBatch.batchSize"]);
                });

                it("should reject if boolean", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchSize: false
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.batchSize must be a `number` type, but the final value was: `false`.");
                    }
                });

                it("should reject if string", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchSize: "12"
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.batchSize must be a `number` type, but the final value was: `\"12\"`.");
                    }
                });

                it("should reject if object", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchSize: {}
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.batchSize must be a `number` type, but the final value was: `{}`.");
                    }
                });

                it("should reject if below 1", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchSize: 0
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.batchSize must be greater than or equal to 1");
                    }
                });
            });

            describe("batchDelay", () => {
                it("should accept if number", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchDelay: 12
                            }
                        }
                    };
                    await ws.initClientOptions();
                    expect(ws.clientOptions.performOpInBatch.batchDelay).to.equal(12);
                    validateObject(ws.clientOptions, ["performOpInBatch.batchDelay"]);
                });

                it("should reject if boolean", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchDelay: false
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.batchDelay must be a `number` type, but the final value was: `false`.");
                    }
                });

                it("should reject if string", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchDelay: "12"
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.batchDelay must be a `number` type, but the final value was: `\"12\"`.");
                    }
                });

                it("should reject if object", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchDelay: {}
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.batchDelay must be a `number` type, but the final value was: `{}`.");
                    }
                });

                it("should reject if below 0", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                batchDelay: -1
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.batchDelay must be greater than or equal to 0");
                    }
                });
            });

            describe("parallel", () => {
                it("should accept if number", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallel: 12
                            }
                        }
                    };
                    await ws.initClientOptions();
                    expect(ws.clientOptions.performOpInBatch.parallel).to.equal(12);
                    validateObject(ws.clientOptions, ["performOpInBatch.parallel"]);
                });

                it("should reject if boolean", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallel: false
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.parallel must be a `number` type, but the final value was: `false`.");
                    }
                });

                it("should reject if string", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallel: "12"
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.parallel must be a `number` type, but the final value was: `\"12\"`.");
                    }
                });

                it("should reject if object", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallel: {}
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.parallel must be a `number` type, but the final value was: `{}`.");
                    }
                });

                it("should reject if below 1", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallel: 0
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.parallel must be greater than or equal to 1");
                    }
                });
            });

            describe("parallelDelay", () => {
                it("should accept if number", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallelDelay: 12
                            }
                        }
                    };
                    await ws.initClientOptions();
                    expect(ws.clientOptions.performOpInBatch.parallelDelay).to.equal(12);
                    validateObject(ws.clientOptions, ["performOpInBatch.parallelDelay"]);
                });

                it("should reject if boolean", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallelDelay: false
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.parallelDelay must be a `number` type, but the final value was: `false`.");
                    }
                });

                it("should reject if string", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallelDelay: "12"
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.parallelDelay must be a `number` type, but the final value was: `\"12\"`.");
                    }
                });

                it("should reject if object", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallelDelay: {}
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.parallelDelay must be a `number` type, but the final value was: `{}`.");
                    }
                });

                it("should reject if below 0", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                parallelDelay: -1
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.parallelDelay must be greater than or equal to 0");
                    }
                });
            });

            describe("returnResult", () => {
                it("should accept if boolean", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                returnResult: true
                            }
                        }
                    };
                    await ws.initClientOptions();
                    expect(ws.clientOptions.performOpInBatch.returnResult).to.equal(true);
                    validateObject(ws.clientOptions, ["performOpInBatch.returnResult"]);
                });

                it("should reject if number", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                returnResult: 12
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.returnResult must be a `boolean` type, but the final value was: `12`.");
                    }
                });

                it("should reject if string", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                returnResult: "12"
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.returnResult must be a `boolean` type, but the final value was: `\"12\"`.");
                    }
                });

                it("should reject if object", async () => {
                    ws.options = {
                        client: {
                            performOpInBatch: {
                                returnResult: {}
                            }
                        }
                    };

                    try {
                        await ws.initClientOptions();
                        throw new Error("Should not have worked");
                    } catch (error) {
                        expect(error.message).to.equal(
                            "performOpInBatch.returnResult must be a `boolean` type, but the final value was: `{}`.");
                    }
                });
            });
        });

        describe("queue option", () => {
            it("defaults to undefined (queue disabled)", async () => {
                expect(ws.clientOptions.queue).to.equal(undefined);
            });

            it("passes through with documented defaults when supplied", async () => {
                ws.options = { client: { queue: {} } };
                await ws.initClientOptions();
                expect(ws.clientOptions.queue).to.deep.equal({
                    maxConcurrent: 5,
                    minDelayMs: 0,
                    maxQueueDepth: 1000,
                    highWaterPct: 0.8,
                    highWaterLogEveryN: 50,
                });
            });

            it("does not allocate _requestQueue when queue option is absent", () => {
                expect(ws._requestQueue).to.equal(null);
            });

            it("allocates a RequestQueue when queue option is provided", () => {
                const http1 = new stubs.StubHTTPClient();
                const http2 = new stubs.StubHTTPClient();
                const ws1 = stubs.getInstance(http1, undefined, {
                    clientOptions: { queue: { maxConcurrent: 3 } },
                });
                const ws2 = stubs.getInstance(http2, undefined, {
                    clientOptions: { queue: { maxConcurrent: 3 } },
                });
                expect(ws1._requestQueue).to.not.equal(null);
                expect(ws2._requestQueue).to.not.equal(null);
                // Each instance owns its own queue — no cross-instance sharing.
                expect(ws1._requestQueue).to.not.equal(ws2._requestQueue);
            });
        });

        describe("constructor option validation (CORE-9107)", () => {
            /**
             * Build a client with the given options.client, expecting the
             * constructor itself to throw (never an unhandled rejection).
             */
            function constructWith(clientOptions) {
                const http = new stubs.StubHTTPClient();
                const log = new stubs.StubLogger();
                return () => stubs.getInstance(http, log, { clientOptions });
            }

            it("throws a catchable error from the constructor when an option is out of range", () => {
                expect(constructWith({
                    batch: {
                        hisWrite: {
                            batchSize: 999999
                        }
                    }
                })).to.throw("batch.hisWrite.batchSize must be less than or equal to 20000");
            });

            it("throws a catchable error from the constructor when an option has the wrong type", () => {
                expect(constructWith({
                    acceptGzip: 12
                })).to.throw("acceptGzip must be a `boolean` type, but the final value was: `12`.");
            });

            describe("batch batchSize above schema maximum", () => {
                const BATCH_SIZE_MAXES = {
                    hisRead: 1000,
                    hisWrite: 20000,
                    hisDelete: 3000,
                    create: 10000,
                    update: 10000,
                    deleteById: 100,
                    deleteByFilter: 100,
                    hisReadByFilter: 1000,
                    addChildrenByFilter: 10000,
                    updateByFilter: 10000,
                    migrateHistory: 20000,
                    hisDeleteByFilter: 3000,
                    updateOrCreate: 10000,
                    multiFind: 200
                };

                for (const [op, max] of Object.entries(BATCH_SIZE_MAXES)) {
                    it(`throws from the constructor for batch.${op}.batchSize > ${max}`, () => {
                        expect(constructWith({
                            batch: {
                                [op]: {
                                    batchSize: max + 1
                                }
                            }
                        })).to.throw(
                            `batch.${op}.batchSize must be less than or equal to ${max}`);
                    });
                }
            });

            describe("batch batchSizeEntity above schema maximum", () => {
                for (const op of ["hisWrite", "hisDelete", "hisDeleteByFilter"]) {
                    it(`throws from the constructor for batch.${op}.batchSizeEntity > 1000`, () => {
                        expect(constructWith({
                            batch: {
                                [op]: {
                                    batchSizeEntity: 1001
                                }
                            }
                        })).to.throw(
                            `batch.${op}.batchSizeEntity must be less than or equal to 1000`);
                    });
                }
            });

            describe("shared batch properties", () => {
                it("throws from the constructor for parallel > 100", () => {
                    expect(constructWith({
                        batch: {
                            hisRead: {
                                parallel: 101
                            }
                        }
                    })).to.throw("batch.hisRead.parallel must be less than or equal to 100");
                });

                it("throws from the constructor for a negative batchDelay", () => {
                    expect(constructWith({
                        batch: {
                            hisRead: {
                                batchDelay: -1
                            }
                        }
                    })).to.throw("batch.hisRead.batchDelay must be greater than or equal to 0");
                });

                it("throws from the constructor for a negative limit", () => {
                    expect(constructWith({
                        batch: {
                            hisReadByFilter: {
                                limit: -1
                            }
                        }
                    })).to.throw("batch.hisReadByFilter.limit must be greater than or equal to 0");
                });

                it("throws from the constructor for a non-boolean returnResult", () => {
                    expect(constructWith({
                        batch: {
                            hisWrite: {
                                returnResult: "yes"
                            }
                        }
                    })).to.throw(
                        "batch.hisWrite.returnResult must be a `boolean` type, " +
                        "but the final value was: `\"yes\"`.");
                });
            });

            describe("performOpInBatch", () => {
                it("throws from the constructor for batchSize above maximum", () => {
                    expect(constructWith({
                        performOpInBatch: {
                            batchSize: 10 ** 9 + 1
                        }
                    })).to.throw(
                        "performOpInBatch.batchSize must be less than or equal to 1000000000");
                });

                it("throws from the constructor for parallel > 100", () => {
                    expect(constructWith({
                        performOpInBatch: {
                            parallel: 101
                        }
                    })).to.throw(
                        "performOpInBatch.parallel must be less than or equal to 100");
                });
            });

            describe("progress", () => {
                it("throws from the constructor for a non-boolean enable", () => {
                    expect(constructWith({
                        progress: {
                            enable: 12
                        }
                    })).to.throw(
                        "progress.enable must be a `boolean` type, but the final value was: `12`.");
                });

                it("throws from the constructor for a non-string increment", () => {
                    expect(constructWith({
                        progress: {
                            increment: 12
                        }
                    })).to.throw(
                        "progress.increment must be a `string` type, but the final value was: `12`.");
                });
            });

            describe("queue", () => {
                it("throws from the constructor for maxConcurrent < 1", () => {
                    expect(constructWith({
                        queue: {
                            maxConcurrent: 0
                        }
                    })).to.throw("queue.maxConcurrent must be greater than or equal to 1");
                });

                it("throws from the constructor for a negative minDelayMs", () => {
                    expect(constructWith({
                        queue: {
                            minDelayMs: -1
                        }
                    })).to.throw("queue.minDelayMs must be greater than or equal to 0");
                });

                it("throws from the constructor for highWaterPct > 1", () => {
                    expect(constructWith({
                        queue: {
                            highWaterPct: 2
                        }
                    })).to.throw("queue.highWaterPct must be less than or equal to 1");
                });

                it("throws from the constructor for a non-integer maxQueueDepth", () => {
                    expect(constructWith({
                        queue: {
                            maxQueueDepth: 1.5
                        }
                    })).to.throw("queue.maxQueueDepth must be an integer");
                });
            });

            describe("top-level options", () => {
                it("throws from the constructor for a non-string impersonateAs", () => {
                    expect(constructWith({
                        impersonateAs: 12
                    })).to.throw(
                        "impersonateAs must be a `string` type, but the final value was: `12`.");
                });

                it("throws from the constructor when batch is not an object", () => {
                    expect(constructWith({
                        batch: "not-an-object"
                    })).to.throw();
                });
            });

            describe("unknown option keys", () => {
                it("throws from the constructor for an unknown top-level key", () => {
                    expect(constructWith({
                        bacth: {}
                    })).to.throw(/unspecified keys: bacth/);
                });

                it("throws from the constructor for an unknown batch op name", () => {
                    expect(constructWith({
                        batch: {
                            hisRaed: {}
                        }
                    })).to.throw(/unspecified keys: hisRaed/);
                });

                it("throws from the constructor for an unknown batch op property", () => {
                    expect(constructWith({
                        batch: {
                            hisRead: {
                                batchSze: 5
                            }
                        }
                    })).to.throw(/unspecified keys: batchSze/);
                });

                it("throws from the constructor for an unknown progress key", () => {
                    expect(constructWith({
                        progress: {
                            enabel: true
                        }
                    })).to.throw(/unspecified keys: enabel/);
                });

                it("throws from the constructor for an unknown queue key", () => {
                    expect(constructWith({
                        queue: {
                            maxConcurrnt: 1
                        }
                    })).to.throw(/unspecified keys: maxConcurrnt/);
                });

                it("throws from the constructor for an unknown performOpInBatch key", () => {
                    expect(constructWith({
                        performOpInBatch: {
                            btachDelay: 0
                        }
                    })).to.throw(/unspecified keys: btachDelay/);
                });

                it("still type-coerces values on non-strict fields", () => {
                    // queue sub-options carry no field-level .strict(), so yup's
                    // historical coercion (e.g. numeric strings) must keep working
                    // alongside unknown-key rejection.
                    const http = new stubs.StubHTTPClient();
                    const log = new stubs.StubLogger();
                    const ws = stubs.getInstance(http, log, {
                        clientOptions: {
                            queue: {
                                maxConcurrent: "5"
                            }
                        }
                    });
                    expect(ws.clientOptions.queue.maxConcurrent).to.equal(5);
                });

                it("still accepts the documented progress.instance option", () => {
                    const fakeInstance = { create: () => {}, update: () => {}, increment: () => {} };
                    const http = new stubs.StubHTTPClient();
                    const log = new stubs.StubLogger();
                    const ws = stubs.getInstance(http, log, {
                        clientOptions: {
                            progress: {
                                enable: true,
                                instance: fakeInstance
                            }
                        }
                    });
                    expect(ws.clientOptions.progress.instance).to.equal(fakeInstance);
                });
            });
        });
    });
});
