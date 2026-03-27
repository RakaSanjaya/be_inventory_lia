module.exports = {
  apps: [
    {
      name: "be-inventory",
      script: "dist/index.js",
      cwd: "/var/www/be_inventory_lia",
      env: {
        NODE_ENV: "production",
        PORT: "4000",
      },
    },
  ],
};
