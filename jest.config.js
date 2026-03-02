module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    transform: {
        "^.+\\.ts$": [
            "ts-jest",
            {
                tsconfig: {
                    module: "commonjs",
                    moduleResolution: "node",
                    esModuleInterop: true,
                    strict: true,
                    target: "ES2022",
                    lib: ["ES2022"],
                },
            },
        ],
    },
    moduleFileExtensions: ["ts", "js"],
};
