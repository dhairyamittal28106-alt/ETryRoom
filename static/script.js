function changeCat(category) {
    console.log("Switching to category:", category);

    fetch(`/change_category?name=${category}`)
        .then(response => response.json())
        .then(data => {
            updateButtonUI(category);
        });
}

function toggleMesh() {
    fetch('/toggle_mesh')
        .then(response => response.json())
        .then(data => {
            const btn = document.getElementById('meshBtn');
            btn.innerText = data.show_mesh ? "Hide Mesh" : "Show Mesh";
            btn.style.background = data.show_mesh ? "#ff4444" : "#44bbff";
        });
}



setInterval(() => {
    fetch('/get_rating')
        .then(response => response.json())
        .then(data => {
            console.log("AI Rating:", data);
        })
        .catch(err => console.error("Error fetching rating:", err));
}, 2000);

function updateButtonUI(activeCat) {
    const buttons = document.querySelectorAll('.category-bar button');
    buttons.forEach(btn => {
        btn.style.background =
            btn.innerText.toLowerCase().includes(activeCat.substring(0, 3))
                ? '#00ff88'
                : '#007bff';
    });
}
