#!/bin/bash
# 只用 bash regex 解析 stdin JSON，git 是唯一的外部指令
input=$(cat)

[[ $input =~ \"display_name\":\"([^\"]+)\" ]] && MODEL="${BASH_REMATCH[1]#Claude }" && MODEL="${MODEL% (*}"
[[ $input =~ \"effort\":\{\"level\":\"([^\"]+)\" ]] && MODEL="$MODEL (${BASH_REMATCH[1]})"
[[ $input =~ \"current_dir\":\"([^\"]+)\" ]] && DIR="${BASH_REMATCH[1]//\\//}"
[[ $input =~ \"context_window\":\{[^}]*\"used_percentage\":([0-9]+) ]] && PCT="${BASH_REMATCH[1]}"

# 用量：5h:23%(2h5m)
NOW=$(date +%s)
limit() {  # $1 = JSON key, $2 = 標籤
    [[ $input =~ \"$1\":\{\"used_percentage\":([0-9.]+),\"resets_at\":([0-9]+) ]] || return
    local pct s=$(( BASH_REMATCH[2] - NOW )) cd=""
    printf -v pct '%.0f' "${BASH_REMATCH[1]}"
    if   (( s >= 86400 )); then cd="$((s/86400))d$((s%86400/3600))h"
    elif (( s >= 3600 ));  then cd="$((s/3600))h$((s%3600/60))m"
    elif (( s > 0 ));      then cd="$((s/60))m"
    fi
    RATE+=" | $2:${pct}%${cd:+($cd)}"
}
limit five_hour 5h
limit seven_day 7d

# git：分支、↑↓、未提交 *
GIT=""
if STATUS=$(git -C "$DIR" --no-optional-locks status --porcelain=v2 --branch 2>/dev/null); then
    [[ $STATUS =~ branch\.head\ ([^$'\n']+) ]] && GIT=" | 🌿 ${BASH_REMATCH[1]}"
    if [[ $STATUS =~ branch\.ab\ \+([0-9]+)\ -([0-9]+) ]]; then
        (( BASH_REMATCH[1] )) && GIT+=" ↑${BASH_REMATCH[1]}"
        (( BASH_REMATCH[2] )) && GIT+=" ↓${BASH_REMATCH[2]}"
    fi
    [[ $'\n'$STATUS =~ $'\n'[^#] ]] && GIT+=" *"
    [[ $GIT =~ (↑|↓|\*) ]] || GIT+=" ✓"
fi

echo "$MODEL 📁 ${DIR##*/}$GIT | ${PCT:-0}% ctx$RATE"
