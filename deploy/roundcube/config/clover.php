<?php
// Integration configuration only. Mail UI and mail actions are stock Roundcube.
$config['product_name'] = 'Roundcube Webmail';
$config['language'] = 'zh_CN';
$config['session_path'] = '/webmail/';
$config['session_samesite'] = 'Lax';
$config['use_https'] = true;
$config['login_username_filter'] = 'email';
$config['imap_timeout'] = 15;
$config['smtp_timeout'] = 20;
$config['clover_panel_url'] = 'http://panel:3000';
$config['clover_sso_key'] = getenv('CLOVER_SSO_SECRET') ?: '';
$config['cipher_method'] = 'AES-256-CBC';
$config['des_key'] = hash('sha256', 'roundcube-session:' . $config['clover_sso_key'], true);
// TLS connections remain inside the private Compose network. The mail certificate
// uses the public mail hostname rather than the internal Docker DNS alias.
$config['imap_conn_options'] = ['ssl' => ['verify_peer' => false, 'verify_peer_name' => false]];
$config['smtp_conn_options'] = $config['imap_conn_options'];
$policy = json_decode(@file_get_contents('/var/clover-policy/policy.json'), true) ?: [];
$config['show_images'] = !empty($policy['allowExternalImages']) ? 1 : 0;
$config['dont_override'] = ['show_images'];
$config['max_message_size'] = (int) ($policy['maxMessageBytes'] ?? (150 * 1024 * 1024));
$config['plugins'] = array_values(array_unique(array_merge($config['plugins'], ['clover_sso'])));
