#!/usr/bin/env node
"use strict";

const { materializeProject } = require("../dist/index.cjs");

function usage() {
  console.error("Usage: aij-base install --dir <new-project-directory>");
  process.exitCode = 2;
}

const [command, option, directory, ...extra] = process.argv.slice(2);
if (command !== "install" || option !== "--dir" || !directory || extra.length) {
  usage();
} else {
  try {
    const result = materializeProject({ destination: directory });
    console.log(JSON.stringify({ status: "LOCAL_PROJECT_INSTALLED", ...result }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
