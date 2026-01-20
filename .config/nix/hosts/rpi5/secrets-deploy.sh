#!/bin/bash
# secrets-deploy.sh - Deploy secrets to Raspberry Pi 5 for clawdbot
#
# All secrets are stored in ~/.clawdbot/.env for unified environment var loading.
#
# Usage:
#   ./secrets-deploy.sh                    # Deploy all secrets (prompted)
#   ./secrets-deploy.sh --openai           # Deploy only OpenAI API key
#   ./secrets-deploy.sh --anthropic        # Deploy only Anthropic API key
#   ./secrets-deploy.sh --telegram-token   # Deploy only Telegram bot token
#   ./secrets-deploy.sh --telegram-id      # Deploy only Telegram user ID
#   ./secrets-deploy.sh --gateway-token    # Deploy only gateway auth token
#   ./secrets-deploy.sh --host 192.168.1.x # Use specific host/IP
#   ./secrets-deploy.sh --restart          # Restart clawdbot-gateway after deploy
#
# Environment:
#   RPI5_HOST - Override default host (default: rpi5)

set -euo pipefail

# Configuration
DEFAULT_HOST="rpi5"
REMOTE_USER="connor"
CLAWDBOT_DIR="/home/${REMOTE_USER}/.clawdbot"
ENV_FILE="${CLAWDBOT_DIR}/.env"

# Parse arguments
HOST="${RPI5_HOST:-$DEFAULT_HOST}"
DEPLOY_OPENAI=false
DEPLOY_ANTHROPIC=false
DEPLOY_TELEGRAM_TOKEN=false
DEPLOY_TELEGRAM_ID=false
DEPLOY_GATEWAY_TOKEN=false
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
        --anthropic|-a)
            DEPLOY_ANTHROPIC=true
            DEPLOY_ALL=false
            shift
            ;;
        --telegram-token|-t)
            DEPLOY_TELEGRAM_TOKEN=true
            DEPLOY_ALL=false
            shift
            ;;
        --telegram-id|-i)
            DEPLOY_TELEGRAM_ID=true
            DEPLOY_ALL=false
            shift
            ;;
        --gateway-token|-g)
            DEPLOY_GATEWAY_TOKEN=true
            DEPLOY_ALL=false
            shift
            ;;
        --restart|-r)
            RESTART_SERVICE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [--host HOST] [--openai] [--anthropic] [--telegram-token] [--telegram-id] [--gateway-token] [--restart]"
            echo ""
            echo "Options:"
            echo "  --host, -h HOST         Target host (default: rpi5, or RPI5_HOST env)"
            echo "  --openai, -o            Deploy OpenAI API key"
            echo "  --anthropic, -a         Deploy Anthropic API key"
            echo "  --telegram-token, -t    Deploy Telegram bot token"
            echo "  --telegram-id, -i       Deploy Telegram user ID"
            echo "  --gateway-token, -g     Deploy gateway auth token"
            echo "  --restart, -r           Restart clawdbot-gateway after deploy"
            echo ""
            echo "With no secret flags, deploys all secrets."
            echo "All secrets are stored in ~/.clawdbot/.env"
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
    DEPLOY_ANTHROPIC=true
    DEPLOY_TELEGRAM_TOKEN=true
    DEPLOY_TELEGRAM_ID=true
    DEPLOY_GATEWAY_TOKEN=true
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

# Ensure clawdbot directory exists on remote
ensure_clawdbot_dir() {
    info "Ensuring ${CLAWDBOT_DIR} exists on remote..."
    ssh "${REMOTE_USER}@${HOST}" "mkdir -p ${CLAWDBOT_DIR} && chmod 700 ${CLAWDBOT_DIR}"
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

# Set or update an env var in the remote .env file
# Usage: set_env_var "VAR_NAME" "value"
set_env_var() {
    local var_name="$1"
    local var_value="$2"

    info "Setting ${var_name} in .env..."
    ssh "${REMOTE_USER}@${HOST}" "
        touch '${ENV_FILE}'
        chmod 600 '${ENV_FILE}'
        if grep -q '^${var_name}=' '${ENV_FILE}' 2>/dev/null; then
            # Use a temp file to avoid issues with special chars in sed
            grep -v '^${var_name}=' '${ENV_FILE}' > '${ENV_FILE}.tmp' || true
            echo '${var_name}=${var_value}' >> '${ENV_FILE}.tmp'
            mv '${ENV_FILE}.tmp' '${ENV_FILE}'
        else
            echo '${var_name}=${var_value}' >> '${ENV_FILE}'
        fi
        chmod 600 '${ENV_FILE}'
    "

    if [[ $? -eq 0 ]]; then
        info "Successfully set ${var_name}"
    else
        error "Failed to set ${var_name}"
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

# Validate Anthropic API key format (starts with sk-ant-)
validate_anthropic_key() {
    local key="$1"
    if [[ ! "$key" =~ ^sk-ant- ]]; then
        warn "Anthropic API key does not start with 'sk-ant-' - are you sure this is correct?"
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
    echo "All secrets stored in: ${ENV_FILE}"
    echo ""

    check_ssh
    ensure_clawdbot_dir

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
            set_env_var "OPENAI_API_KEY" "$openai_key"
            deployed=true
        fi
        unset openai_key  # Clear from memory
    fi

    # Deploy Anthropic API key
    if $DEPLOY_ANTHROPIC; then
        echo ""
        info "Anthropic API Key deployment"
        local anthropic_key=""
        if ! read_secret "Enter Anthropic API key" anthropic_key; then
            error "Aborted Anthropic key deployment"
        else
            if ! validate_anthropic_key "$anthropic_key"; then
                unset anthropic_key
                error "Aborted"
                exit 1
            fi
            set_env_var "ANTHROPIC_API_KEY" "$anthropic_key"
            deployed=true
        fi
        unset anthropic_key  # Clear from memory
    fi

    # Deploy Telegram bot token
    if $DEPLOY_TELEGRAM_TOKEN; then
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
            set_env_var "TELEGRAM_BOT_TOKEN" "$telegram_token"
            deployed=true
        fi
        unset telegram_token  # Clear from memory
    fi

    # Deploy Telegram user ID
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
            set_env_var "TELEGRAM_ALLOW_FROM" "tg:${telegram_id}"
            deployed=true
        fi
        unset telegram_id  # Clear from memory
    fi

    # Deploy gateway auth token
    if $DEPLOY_GATEWAY_TOKEN; then
        echo ""
        info "Gateway auth token deployment"
        local token=""
        if ! read_secret "Enter gateway auth token" token; then
            error "Aborted token deployment"
        else
            set_env_var "CLAWDBOT_GATEWAY_TOKEN" "$token"
            deployed=true
        fi
        unset token  # Clear from memory
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
