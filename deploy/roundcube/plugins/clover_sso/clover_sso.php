<?php
/**
 * Clover panel login bridge. This plugin only authenticates the Roundcube session;
 * it does not replace or alter any mail UI, editor, search or mail actions.
 */
class clover_sso extends rcube_plugin
{
    public function init()
    {
        $this->add_hook('startup', [$this, 'startup']);
        $this->add_hook('storage_connect', [$this, 'storage_connect']);
        $this->add_hook('smtp_connect', [$this, 'smtp_connect']);
    }

    public function startup($args)
    {
        if ($args['action'] !== 'plugin.clover_sso') {
            return $args;
        }
        $rcmail = rcmail::get_instance();
        $ticket = rcube_utils::get_input_string('_clover_ticket', rcube_utils::INPUT_POST);
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', (string) $ticket)) {
            $this->fail('invalid ticket');
        }
        $curl = curl_init($rcmail->config->get('clover_panel_url') . '/api/internal/roundcube/ticket');
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Clover-SSO-Key: ' . $rcmail->config->get('clover_sso_key')],
            CURLOPT_POSTFIELDS => json_encode(['ticket' => $ticket]),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $body = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        $auth = json_decode((string) $body, true);
        if ($status !== 200 || !is_array($auth) || empty($auth['login']) || empty($auth['masterUser']) || empty($auth['masterPassword'])) {
            $this->fail('backend ticket exchange failed, HTTP ' . $status);
        }

        $rcmail->kill_session();
        $_SESSION['clover_master_user'] = $auth['masterUser'];
        // Roundcube already encrypts the session password. Do not duplicate it.
        if (!$rcmail->login($auth['login'], $auth['masterPassword'], 'ssl://mail:993', false)) {
            unset($_SESSION['clover_master_user']);
            $this->fail('IMAP login failed, code ' . (string) $rcmail->login_error());
        }
        $rcmail->session->remove('temp');
        $rcmail->session->regenerate_id(false);
        $rcmail->session->set_auth_cookie();
        $rcmail->log_login();
        $rcmail->output->redirect(['_task' => 'mail'], 0, true);
        exit;
    }

    public function storage_connect($args)
    {
        if (!empty($_SESSION['clover_master_user'])) {
            // Keep the Roundcube account/identity as the real mailbox; alter only
            // the wire login passed to Dovecot's native master-user mechanism.
            $suffix = '*' . $_SESSION['clover_master_user'];
            if (substr($args['user'], -strlen($suffix)) !== $suffix) {
                $args['user'] .= $suffix;
            }
            $args['auth_type'] = 'PLAIN';
        }
        return $args;
    }

    public function smtp_connect($args)
    {
        if (!empty($_SESSION['clover_master_user'])) {
            $args['smtp_user'] = '%u*' . $_SESSION['clover_master_user'];
            $args['smtp_pass'] = '%p';
            $args['smtp_auth_type'] = 'PLAIN';
        }
        return $args;
    }

    private function fail($reason)
    {
        error_log('[clover-sso] ' . $reason);
        header('Cache-Control: no-store');
        header('Location: /webmail?error=sso', true, 303);
        exit;
    }
}
