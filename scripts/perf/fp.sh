#!/bin/bash
# Physical footprint (Activity Monitor's "Memory") per process of perf group $1, MB
for p in $(ps -A -o pgid=,pid= | awk -v g=$1 '$1==g {print $2}'); do
  t=$(ps -o args= -p $p | grep -o -- '--type=[a-z-]*' | head -1 | cut -d= -f2); [ -z "$t" ] && t=main
  f=$(footprint -p $p 2>/dev/null | grep -o 'Footprint: [0-9.]* [KMG]B' | head -1 | awk '{v=$2; if ($3=="KB") v=v/1024; if ($3=="GB") v=v*1024; printf "%d", v}')
  echo "$t $f"
done
