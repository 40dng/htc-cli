#!/usr/bin/env bash
# HTC (Hatachi) — instalador
#   curl -fsSL https://prefeitodev.com/htc-cli/xinstaller | bash
set -eu

HTC_BASE="${HTC_BASE:-https://prefeitodev.com/htc-cli}"
HTC_HOME="${HTC_HOME:-$HOME/.htc}"
BIN_DIR="$HTC_HOME/bin"
LINK_DIR="$HOME/.local/bin"
MARCA="# htc"

if [ -t 1 ]; then
	C=$'\033[38;2;203;27;69m'; D=$'\033[2m'; G=$'\033[38;2;76;195;138m'
	R=$'\033[38;2;255;92;92m'; Z=$'\033[0m'
else
	C=""; D=""; G=""; R=""; Z=""
fi

banner() {
	printf '%s\n' "${C}  ██╗  ██╗████████╗ ██████╗ ${Z}"
	printf '%s\n' "${C}  ██║  ██║╚══██╔══╝██╔════╝ ${Z}"
	printf '%s\n' "${C}  ███████║   ██║   ██║      ${Z}"
	printf '%s\n' "${C}  ██╔══██║   ██║   ██║      ${Z}"
	printf '%s\n' "${C}  ██║  ██║   ██║   ╚██████╗ ${Z}"
	printf '%s\n' "${C}  ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ${Z}"
	printf '%s\n' "${C}  ⠀⣀⣤⣤⣤⣤⣀⠀⠀⠀⠀${Z}"
	printf '%s\n' "${C}  ⣠⣿⠐⣿⣿⣿⣿⣷⣦⡀⠀${Z}  ${D}hatachi${Z}"
	printf '%s\n' "${C}  ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡄${Z}  ${D}security is an illusion.${Z}"
	printf '%s\n' "${C}  ⠈⠻⠿⠿⠿⠿⠿⠿⠟⠁⠀${Z}"
	printf '\n'
}

ok()    { printf '  %s+%s %s\n' "$G" "$Z" "$1"; }
erro()  { printf '  %sx%s %s\n' "$R" "$Z" "$1" >&2; }
passo() { printf '  %s>%s %s\n' "$D" "$Z" "$1"; }
die()   { erro "$1"; exit 1; }

detect_os() {
	case "$(uname -s)" in
		Darwin) echo "darwin" ;;
		Linux) echo "linux" ;;
		*) die "SO nao suportado: $(uname -s)" ;;
	esac
}

detect_arch() {
	case "$(uname -m)" in
		x86_64|amd64) echo "x64" ;;
		arm64|aarch64) echo "arm64" ;;
		*) die "arquitetura nao suportada: $(uname -m)" ;;
	esac
}

add_path() {
	for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
		[ -f "$rc" ] || continue
		grep -q "$MARCA" "$rc" 2>/dev/null && continue
		printf '\nexport PATH="%s:$PATH" %s\n' "$LINK_DIR" "$MARCA" >> "$rc"
	done
	ok "PATH atualizado (${LINK_DIR})"
}

instalar() {
	os="$(detect_os)"; arch="$(detect_arch)"
	versao="${HTC_VERSION:-latest}"
	variant=""
	if [ "$os" = "linux" ] && [ -f /etc/alpine-release ]; then variant="-musl"; fi
	url="$HTC_BASE/$versao/htc-$os-$arch$variant"

	mkdir -p "$BIN_DIR" "$LINK_DIR"
	command -v curl >/dev/null 2>&1 || die "curl nao encontrado"
	passo "baixando $os/$arch$variant"

	curl -fsSL "$url" -o "$BIN_DIR/htc.tmp" || die "download falhou ($url)"
	if [ "$(head -c 1 "$BIN_DIR/htc.tmp")" = "<" ]; then
		rm -f "$BIN_DIR/htc.tmp"
		die "o servidor devolveu HTML — a pasta htc-cli nao existe la"
	fi

	if curl -fsSL "$HTC_BASE/$versao/SHA256SUMS" -o "$BIN_DIR/SHA256SUMS" 2>/dev/null; then
		esperado=$(grep " htc-$os-$arch$variant$" "$BIN_DIR/SHA256SUMS" | awk '{print $1}')
		if [ -n "$esperado" ]; then
			if command -v sha256sum >/dev/null 2>&1; then
				atual=$(sha256sum "$BIN_DIR/htc.tmp" | awk '{print $1}')
			else
				atual=$(shasum -a 256 "$BIN_DIR/htc.tmp" | awk '{print $1}')
			fi
			[ "$esperado" = "$atual" ] || die "checksum nao confere"
			ok "checksum"
		fi
		rm -f "$BIN_DIR/SHA256SUMS"
	fi

	mv "$BIN_DIR/htc.tmp" "$BIN_DIR/htc"
	chmod 755 "$BIN_DIR/htc"
	ln -sf "$BIN_DIR/htc" "$LINK_DIR/htc"
	ok "binario em ${BIN_DIR}/htc"
	add_path
	printf '\n  %spronto.%s rode: %shtc%s\n' "$G" "$Z" "$C" "$Z"
	printf '  %sdesinstalar: htc uninstall --force%s\n\n' "$D" "$Z"
}

desinstalar() {
	bin="$HTC_HOME/bin/htc"
	if [ -x "$bin" ]; then
		"$bin" uninstall --force
	else
		rm -rf "$HTC_HOME"
		rm -f "$LINK_DIR/htc"
		ok "removido (~/.htc e link)"
	fi
}

menu() {
	printf '  %s1%s instalar / atualizar\n' "$C" "$Z"
	printf '  %s2%s desinstalar\n' "$C" "$Z"
	printf '  %s3%s sair\n\n' "$C" "$Z"
	printf '  escolha [1-3]: '
	read -r opcao || opcao="1"
	case "$opcao" in
		2) desinstalar ;;
		3) exit 0 ;;
		*) instalar ;;
	esac
}

banner
if [ -t 0 ] && [ -t 1 ] && [ "${HTC_NO_MENU:-0}" != "1" ]; then
	menu
else
	instalar
fi
