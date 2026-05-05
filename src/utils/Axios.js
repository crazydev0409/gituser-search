import axios from "axios";

const Axios = axios.create({
    baseURL: "https://api.github.com",
});

export default Axios;
