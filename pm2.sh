#!/bin/bash
# Delegate to SceneShop PM2 script
cd "$(dirname "$0")/SceneShop_v0.19/SceneShop"
exec ./pm2.sh "$@"
