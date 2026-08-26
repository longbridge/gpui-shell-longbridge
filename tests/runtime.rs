use std::{
    ops::Deref as _,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use gpui::{IntoElement as _, TestAppContext, VisualTestContext};
use gpui_shell::ShellRuntime;

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("app")
}

#[gpui::test]
fn logged_out_application_loads_through_the_public_shell_runtime(cx: &mut TestAppContext) {
    cx.update(gpui_shell::init);
    let root = app_dir();
    let manifest = gpui_shell::plugin::PluginManifest::read(&root).expect("plugin manifest");
    gpui_shell::set_capabilities(manifest.capabilities(&root, &std::env::temp_dir()));
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_nanos();
    gpui_shell::set_store_path(std::env::temp_dir().join(format!(
        "gpui-shell-longbridge-runtime-test-{}-{nonce}.json",
        std::process::id()
    )));

    let runtime = cx.update(ShellRuntime::new).expect("runtime");
    let view_type = runtime.load_app(&root, manifest.entry()).expect("load app");
    let window = cx.add_window(|_, _| Empty);
    let mut context = VisualTestContext::from_window(*window.deref(), cx);
    let view = context
        .update(|window, cx| runtime.instantiate_view(&view_type, window, cx))
        .expect("instantiate app");

    context.run_until_parked();
    let draw_view = view.clone();
    context.draw(
        gpui::Point::default(),
        gpui::size(gpui::px(1120.), gpui::px(760.)),
        move |_, _| draw_view.into_any_element(),
    );
    let rendered = context.update(|_, cx| {
        view.read(cx)
            .snapshot()
            .map(gpui_shell::RenderSnapshot::debug_tree)
            .unwrap_or_default()
    });

    assert!(rendered.contains("Sign in required"), "{rendered}");
    assert!(!rendered.contains("Stock detail"), "{rendered}");
    assert!(!rendered.contains("Holdings"), "{rendered}");
}

struct Empty;

impl gpui::Render for Empty {
    fn render(
        &mut self,
        _: &mut gpui::Window,
        _: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        gpui::div()
    }
}
