//! rustls will not choose between two crypto providers. If a dependency ever
//! brings a second one in, every TLS client in the process starts panicking
//! with "Could not automatically determine the process-level CryptoProvider"
//! -- on a background socket, so the window comes up and the connection dies
//! behind it. That is what happened when `gpui-kit` still carried an unused
//! `reqwest_client`, whose `aws-lc-rs` met the runtime's `ring`.
//!
//! Building a client without naming a provider is what proves there is still
//! only one to choose from: this goes red the moment a second one arrives,
//! rather than a user's socket doing it later.

#[test]
fn the_dependency_graph_leaves_rustls_one_crypto_provider() {
    rustls::ClientConfig::builder()
        .with_root_certificates(rustls::RootCertStore::empty())
        .with_no_client_auth();
}
