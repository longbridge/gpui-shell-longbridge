//! Two rustls crypto providers are compiled into this binary: `gpui-kit` takes
//! rustls' default features, which select `aws-lc-rs`, and the runtime's own
//! HTTP and WebSocket clients select `ring`. rustls will not guess between
//! them, so `main` names one for the process before anything opens a socket.
//!
//! This test builds a client the way the runtime's WebSocket does, against the
//! same dependency graph, so the naming staying correct is checked rather than
//! assumed.

#[test]
fn a_tls_client_can_be_built_once_the_process_provider_is_named() {
    // Ignored rather than unwrapped: a provider already installed by whatever
    // ran first in this process is the state this asserts about, not a failure.
    let _ = rustls::crypto::ring::default_provider().install_default();

    rustls::ClientConfig::builder()
        .with_root_certificates(rustls::RootCertStore::empty())
        .with_no_client_auth();
}
