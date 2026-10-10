#!/bin/sh
set -eu

quality=""
output_directory=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --video-size)
      quality="$2"
      shift 2
      ;;
    --output-directory)
      output_directory="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [ "$quality" = "silent" ]; then
  sleep 30
fi

if [ "$quality" = "chatty" ]; then
  count=0
  while [ "$count" -lt 5 ]; do
    echo "working"
    sleep 0.03
    count=$((count + 1))
  done
fi

mkdir -p "$output_directory"
printf 'fixture media' > "$output_directory/result.mp4"
echo "Percent Complete=100%"
