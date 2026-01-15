#!/bin/bash
# secrets-deploy.sh - Deploy secrets to Raspberry Pi 5 for clawdbot
#
# Usage:
#   ./secrets-deploy.sh                    # Deploy all secrets (prompted)
#   ./secrets-deploy.sh --openai           # Deploy only OpenAI API key
#   ./secrets-deploy.sh --telegram         # Deploy only Telegram bot token
#   ./secrets-deploy.sh --telegram-id      # Deploy only Telegram user ID
#   ./secrets-deploy.sh --password         # Deploy only gateway web UI password
#   ./secrets-deploy.sh --host 192.168.1.x # Use specific host/IP
#   ./secrets-deploy.sh --restart          # Restart clawdbot-gateway after deploy
#
# Environment:
#   RPI5_HOST - Override default host (default: rpi5)

set -euo pipefail

# Configuration
DEFAULT_HOST="rpi5"
REMOTE_USER="connor"
SECRETS_DIR="/home/${REMOTE_USER}/.secrets"

# Parse arguments
HOST="${RPI5_HOST:-$DEFAULT_HOST}"
DEPLOY_OPENAI=false
DEPLOY_TELEGRAM=false
DEPLOY_TELEGRAM_ID=false
DEPLOY_PASSWORD=false
RESTART_SERVICE=false
DEPLOY_ALL=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --host|-h)
            HOST="$2"
            shift 2
            ;;
        --openai|-o)
            DEPLOY_OPENAI=true
            DEPLOY_ALL=false
            shift
            ;;
        --telegram|-t)
            DEPLOY_TELEGRAM=true
            DEPLOY_ALL=false
            shift
            ;;
        --telegram-id|-i)
            DEPLOY_TELEGRAM_ID=true
            DEPLOY_ALL=false
            shift
            ;;
        --password|-p)
            DEPLOY_PASSWORD=true
            DEPLOY_ALL=false
            shift
            ;;
        --restart|-r)
            RESTART_SERVICE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [--host HOST] [--openai] [--telegram] [--telegram-id] [--password] [--restart]"
            echo ""
            echo "Options:"
            echo "  --host, -h HOST     Target host (default: rpi5, or RPI5_HOST env)"
            echo "  --openai, -o        Deploy only OpenAI API key"
            echo "  --telegram, -t      Deploy only Telegram bot token"
            echo "  --telegram-id, -i   Deploy only Telegram user ID"
            echo "  --password, -p      Deploy only gateway web UI password"
            echo "  --restart, -r       Restart clawdbot-gateway after deploy"
            echo ""
            echo "With no secret flags, deploys all secrets."
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# If deploying all, set all flags
if $DEPLOY_ALL; then
    DEPLOY_OPENAI=true
    DEPLOY_TELEGRAM=true
    DEPLOY_TELEGRAM_ID=true
    DEPLOY_PASSWORD=true
fi

# Colours for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No colour

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Verify SSH connectivity (no BatchMode - Tailscale SSH uses its own auth)
check_ssh() {
    info "Checking SSH connectivity to ${REMOTE_USER}@${HOST}..."
    if ! ssh -o ConnectTimeout=10 "${REMOTE_USER}@${HOST}" true 2>/dev/null; then
        error "Cannot connect to ${REMOTE_USER}@${HOST}"
        error "Ensure:"
        error "  - The Pi is running and accessible"
        error "  - Tailscale is connected (try: ts status)"
        exit 1
    fi
    info "SSH connection successful"
}

# Ensure secrets directory exists on remote
ensure_secrets_dir() {
    info "Ensuring ${SECRETS_DIR} exists on remote..."
    ssh "${REMOTE_USER}@${HOST}" "mkdir -p ${SECRETS_DIR} && chmod 700 ${SECRETS_DIR}"
}

# Read secret safely (no echo)
# Usage: read_secret "Prompt text" variable_name
read_secret() {
    local prompt="$1"
    local varname="$2"

    # Prompt without echo
    echo -n "${prompt}: "
    IFS= read -rs value
    echo ""  # newline after hidden input

    # Validate non-empty
    if [[ -z "$value" ]]; then
        error "Empty value provided"
        return 1
    fi

    # Export to caller's variable
    printf -v "$varname" '%s' "$value"
}

# Deploy a secret file to remote
# Usage: deploy_secret "filename" "content"
deploy_secret() {
    local filename="$1"
    local content="$2"
    local remote_path="${SECRETS_DIR}/${filename}"

    info "Deploying ${filename}..."

    # Write secret via SSH stdin (avoids command line exposure)
    printf '%s' "$content" | ssh "${REMOTE_USER}@${HOST}" \
        "cat > '${remote_path}' && chmod 600 '${remote_path}'"

    if [[ $? -eq 0 ]]; then
        info "Successfully deployed ${filename}"
    else
        error "Failed to deploy ${filename}"
        return 1
    fi
}

# Validate OpenAI API key format (starts with sk-)
validate_openai_key() {
    local key="$1"
    if [[ ! "$key" =~ ^sk- ]]; then
        warn "OpenAI API key does not start with 'sk-' - are you sure this is correct?"
        echo -n "Continue anyway? [y/N]: "
        read -r confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            return 1
        fi
    fi
}

# Validate Telegram bot token format (numbers:alphanumeric)
validate_telegram_token() {
    local token="$1"
    if [[ ! "$token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
        warn "Telegram token format looks unusual (expected: 123456:ABC-xyz)"
        echo -n "Continue anyway? [y/N]: "
        read -r confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            return 1
        fi
    fi
}

# Validate Telegram user ID format (numeric)
validate_telegram_id() {
    local id="$1"
    if [[ ! "$id" =~ ^[0-9]+$ ]]; then
        error "Telegram user ID must be numeric"
        return 1
    fi
}

# Main deployment logic
main() {
    echo "=== Secrets Deploy for Raspberry Pi 5 ==="
    echo "Target: ${REMOTE_USER}@${HOST}"
    echo ""

    check_ssh
    ensure_secrets_dir

    local deployed=false

    # Deploy OpenAI API key
    if $DEPLOY_OPENAI; then
        echo ""
        info "OpenAI API Key deployment"
        local openai_key=""
        if ! read_secret "Enter OpenAI API key" openai_key; then
            error "Aborted OpenAI key deployment"
        else
            if ! validate_openai_key "$openai_key"; then
                unset openai_key
                error "Aborted"
                exit 1
            fi
            deploy_secret "clawdbot.env" "OPENAI_API_KEY=${openai_key}"
            deployed=true
        fi
        unset openai_key  # Clear from memory
    fi

    # Deploy Telegram bot token
    if $DEPLOY_TELEGRAM; then
        echo ""
        info "Telegram bot token deployment"
        local telegram_token=""
        if ! read_secret "Enter Telegram bot token" telegram_token; then
            error "Aborted Telegram token deployment"
        else
            if ! validate_telegram_token "$telegram_token"; then
                unset telegram_token
                error "Aborted"
                exit 1
            fi
            deploy_secret "telegram-bot-token" "$telegram_token"
            deployed=true
        fi
        unset telegram_token  # Clear from memory
    fi

    # Deploy Telegram user ID (as JSON for clawdbot $include)
    if $DEPLOY_TELEGRAM_ID; then
        echo ""
        info "Telegram user ID deployment"
        local telegram_id=""
        if ! read_secret "Enter Telegram user ID (numeric)" telegram_id; then
            error "Aborted Telegram user ID deployment"
        else
            if ! validate_telegram_id "$telegram_id"; then
                unset telegram_id
                error "Aborted"
                exit 1
            fi
            # Format as JSON array for clawdbot $include directive
            deploy_secret "telegram-users.json" "[\"tg:${telegram_id}\"]"
            deployed=true
        fi
        unset telegram_id  # Clear from memory
    fi

    # Deploy gateway password
    if $DEPLOY_PASSWORD; then
        echo ""
        info "Gateway web UI password deployment"
        local password=""
        if ! read_secret "Enter gateway web UI password" password; then
            error "Aborted password deployment"
        else
            deploy_secret "clawdbot-gateway-password" "$password"
            deployed=true
        fi
        unset password  # Clear from memory
    fi

    # Restart service if requested and something was deployed
    if $RESTART_SERVICE && $deployed; then
        echo ""
        info "Restarting clawdbot-gateway service..."
        # Need XDG_RUNTIME_DIR for systemctl --user over SSH
        ssh "${REMOTE_USER}@${HOST}" 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart clawdbot-gateway'

        # Brief wait then check status
        sleep 2
        info "Checking service status..."
        ssh "${REMOTE_USER}@${HOST}" 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user status clawdbot-gateway --no-pager' || true
    elif $RESTART_SERVICE && ! $deployed; then
        warn "No secrets deployed, skipping service restart"
    fi

    echo ""
    if $deployed; then
        info "Deployment complete!"
        if ! $RESTART_SERVICE; then
            echo ""
            echo "To restart the service manually:"
            echo "  ssh ${REMOTE_USER}@${HOST} 'systemctl --user restart clawdbot-gateway'"
        fi
    else
        warn "No secrets were deployed"
    fi
}

main "$@"
